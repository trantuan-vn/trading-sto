// Helper functions
const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

const sendToErrorQueue = async (message: Message, error: Error, env: Env): Promise<void> => {
  try {
    await env.ERROR_QUEUE.send({
      originalMessage: message.body,
      error: error.message,
      stack: error.stack,
      timestamp: Date.now(),
      queueId: message.id,
      sourceQueue: 'input-part-0',
      environment: env.ENVIRONMENT || 'production'
    });
  } catch (dlqError) {
    console.error('[QueueWorker] Failed to send to DLQ:', dlqError);
  }
};

interface CleanupResult {
  success: boolean;
  deletedCount?: number;
  markedCount?: number;
  processedUpTo?: number;
  error?: string;
}

const cleanupProcessedRecords = async (
  instanceId: string,
  table: string,
  env: Env,
  cleanupMethod: 'delete' | 'mark' = 'delete',
  maxId: number
): Promise<CleanupResult> => {
  try {
    const doId = env.USER_DO.idFromString(instanceId);
    const stub = env.USER_DO.get(doId);

    const response = await stub.fetch('https://do.internal/queue/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table,
        cleanupMethod,
        upToId: maxId
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to cleanup records: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as any;
    console.log(`[QueueWorker] Cleaned up records from ${instanceId}/${table}, method: ${cleanupMethod}`);

    return {
      success: true,
      deletedCount: result.data?.deletedCount,
      markedCount: result.data?.markedCount,
      processedUpTo: result.data?.processedUpTo
    };
  } catch (error) {
    console.error(`[QueueWorker] Failed to cleanup from UserDO ${instanceId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

interface ProcessedItem {
  data: any;
  message: Message;
  id?: number;
  attempt: number;
}

interface ChunkStats {
  maxId: number;
  minId: number;
  aeDataPoints: any[];
  messagesById: Map<number, ProcessedItem>;
}

const prepareChunkStats = (chunk: ProcessedItem[], table: string, instanceId: string): ChunkStats => {
  const stats: ChunkStats = {
    maxId: 0,
    minId: Infinity,
    aeDataPoints: [],
    messagesById: new Map()
  };

  for (const item of chunk) {
    try {
      const record = item.data;
      const recordId = record.id;

      if (recordId !== undefined) {
        const id = recordId;

        if (id > stats.maxId) stats.maxId = id;
        if (id < stats.minId) stats.minId = id;
        stats.messagesById.set(id, item);
      }

      // Tạo index kết hợp từ các thông tin
      const combinedIndex = `${table}|${instanceId}|${recordId}`;

      stats.aeDataPoints.push({
        blobs: [
          JSON.stringify({
            table,
            operation: 'process',
            data: record.data,
            timestamp: record.batchInfo?.timestamp,
            userId: instanceId,
            id: recordId
          }),
          table,
          instanceId,
					recordId
        ],
        doubles: [record.batchInfo?.timestamp || Date.now(), recordId || 0],
        indexes: [combinedIndex]
      });
    } catch (error) {
      console.error('[QueueWorker] Error preparing item:', error);
    }
  }

  return stats;
};

const processChunk = async (
  instanceId: string,
  table: string,
  chunk: ProcessedItem[],
  env: Env
): Promise<void> => {
  const stats = prepareChunkStats(chunk, table, instanceId);

  // Send to Analytics Engine
  try {
    for (const dataPoint of stats.aeDataPoints) {
      env.AE_DATASET.writeDataPoint(dataPoint);
    }
    console.log(`[QueueWorker] Sent ${chunk.length} records to AE from ${instanceId}/${table}, id range: ${stats.minId}-${stats.maxId}`);

    // Update processed records
    if (stats.maxId > 0) {
      await handleProcessedRecords(instanceId, table, env, stats.maxId, chunk);
    } else {
      ackAllMessages(chunk);
      console.log(`[QueueWorker] Processed ${chunk.length} records without id from ${instanceId}/${table}`);
    }
  } catch (error) {
    console.error(`[QueueWorker] Failed to process chunk from ${instanceId}/${table}:`, error);
    retryAllMessages(chunk);
  }
};

const handleProcessedRecords = async (
  instanceId: string,
  table: string,
  env: Env,
  maxId: number,
  chunk: ProcessedItem[]
): Promise<void> => {
  try {
    const updateResult = await cleanupProcessedRecords(instanceId, table, env, 'mark', maxId);

    if (updateResult.success) {
      await cleanupProcessedRecords(instanceId, table, env, 'delete', maxId);
      ackAllMessages(chunk);
      console.log(`[QueueWorker] Processed ${chunk.length} records, updated to id ${maxId} for ${instanceId}/${table}`);
    } else {
      throw new Error(`Update failed: ${updateResult.error}`);
    }
  } catch (error) {
    console.error(`[QueueWorker] Cleanup failed for ${instanceId}/${table}:`, error);
    ackAllMessages(chunk); // Still ack since AE processing succeeded
  }
};

const ackAllMessages = (chunk: ProcessedItem[]): void => {
  chunk.forEach(item => item.message.ack());
};

const retryAllMessages = (chunk: ProcessedItem[]): void => {
  chunk.forEach(item => item.message.retry());
};

const QUEUE_TABLE_NAMES = [
  "service_usages", "orders", "order_items",
  "order_discounts", "payments", "refunds"
];

const parseMessage = (message: Message): {
  instanceId: string;
  table: string;
  recordId?: number;
  data: any;
}[] | null => {
  try {
		const dataArr = message.body as any[];
		// Kiểm tra nếu không phải array
    if (!Array.isArray(dataArr)) {
      console.warn('[QueueWorker] message.body is not an array:', message.body);
      return null;
    }
		let returnArr = [];
		for (const item of dataArr) {
			const data = JSON.parse(item.body);
			const instanceId = data.batchInfo?.userId;
			const table = data.batchInfo?.table;
			const recordId = data.id || data.data?.id;

			if (!instanceId || instanceId === 'unknown') {
				console.warn('[QueueWorker] Missing instanceId:', JSON.stringify(data));
				return null;
			}

			if (!QUEUE_TABLE_NAMES.includes(table)) {
				console.warn(`[QueueWorker] Table ${table} is not a queue table`);
				return null;
			}
			returnArr.push({
				instanceId,
				table,
				recordId: recordId ? (typeof recordId === 'string' ? parseInt(recordId) : recordId) : undefined,
				data
			});
		}

    return returnArr;
  } catch (error) {
    console.error('[QueueWorker] Failed to parse message:', error);
    return null;
  }
};

const processInputQueue = async (batch: MessageBatch, env: Env): Promise<void> => {
  const BATCH_SIZE = parseInt(env.BATCH_SIZE || '100');
  const instanceTableGroups = new Map<string, Map<string, ProcessedItem[]>>();

  // Group messages by instance and table
  for (const message of batch.messages) {
    const parsed = parseMessage(message);
    if (!parsed) {
      message.ack();
      continue;
    }
		for (const parsedItem of parsed) {
			const { instanceId, table, data } = parsedItem;

			if (!instanceTableGroups.has(instanceId)) {
				instanceTableGroups.set(instanceId, new Map());
			}

			const tableMap = instanceTableGroups.get(instanceId)!;
			if (!tableMap.has(table)) {
				tableMap.set(table, []);
			}

			tableMap.get(table)!.push({
				data,
				message,
				id: parsedItem.recordId,
				attempt: 0
			});
		}
  }

  // Process all chunks
  const processingPromises: Promise<void>[] = [];

  for (const [instanceId, tableMap] of instanceTableGroups) {
    for (const [table, messages] of tableMap) {
      const chunks = chunkArray(messages, BATCH_SIZE);
      chunks.forEach(chunk => {
        processingPromises.push(processChunk(instanceId, table, chunk, env));
      });
    }
  }

  // Wait for all processing to complete
  const results = await Promise.allSettled(processingPromises);

  // Log results
  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  console.log(`[QueueWorker] Batch complete: ${successful} successful, ${failed} failed`);

  // Log errors
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`[QueueWorker] Chunk ${index} failed:`, result.reason);
    }
  });
};

const processErrorQueue = async (batch: MessageBatch, env: Env): Promise<void> => {
  console.log(`[QueueWorker] Processing ${batch.messages.length} DLQ messages`);

  for (const message of batch.messages) {
    try {
      const errorData = message.body as any;

      console.error('[QueueWorker] DLQ Entry:', {
        timestamp: new Date(errorData.timestamp).toISOString(),
        error: errorData.error,
        userId: errorData.userId,
        instanceId: errorData.instanceId,
        table: errorData.table,
        id: errorData.id,
        sourceQueue: errorData.sourceQueue || 'unknown'
      });

      message.ack();
    } catch (error) {
      console.error('[QueueWorker] Failed to process DLQ message:', error);
      message.ack(); // Avoid loop
    }
  }
};

// HTTP Handler
const handleHttpRequest = async (req: Request, env: Env): Promise<Response> => {
  const url = new URL(req.url);

  const routes: Record<string, (req: Request) => Promise<Response>> = {
    '/health': async () => new Response(JSON.stringify({
      status: 'healthy',
      service: 'Queue Worker',
      timestamp: Date.now(),
      environment: env.ENVIRONMENT || 'production'
    }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
    }),

    '/metrics': async () => new Response(JSON.stringify({
      queues: { input: 'input-part-0', error: 'error-queue-dlq' },
      settings: {
        batch_size: env.BATCH_SIZE || '100',
        max_retries: env.MAX_RETRIES || '3'
      },
      queue_tables: QUEUE_TABLE_NAMES
    }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
    }),

    '/stats': async () => new Response(JSON.stringify({
      queue_worker: {
        version: '2.1.0',
        timestamp: Date.now(),
        queue_table_count: QUEUE_TABLE_NAMES.length,
        processing_model: 'id-based'
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    }),

    '/test-cleanup': async (req) => {
      try {
        const { instanceId, table, cleanupMethod, upToId } = await req.json() as {
          instanceId: string;
          table: string;
          cleanupMethod?: 'delete' | 'mark';
          upToId: number;
        };

        if (!instanceId || !table) {
          return new Response(JSON.stringify({ error: 'Missing parameters' }), { status: 400 });
        }

        const result = await cleanupProcessedRecords(
          instanceId,
          table,
          env,
          cleanupMethod || 'delete',
          upToId
        );

        return new Response(JSON.stringify({ ...result, instanceId, table }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          error: error instanceof Error ? error.message : String(error)
        }), { status: 500 });
      }
    }
  };

  const handler = routes[url.pathname];
  if (handler) {
    return await handler(req);
  }

  return new Response('Queue Worker (ID-based) - Available: /health, /metrics, /stats, /test-cleanup', {
    headers: { 'Content-Type': 'text/plain' }
  });
};

// Main Export
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return handleHttpRequest(req, env);
  },

  async queue(batch: MessageBatch, env: Env): Promise<void> {
    console.log(`[QueueWorker] Processing ${batch.queue} with ${batch.messages.length} messages`);

    const queueHandlers: Record<string, (batch: MessageBatch, env: Env) => Promise<void>> = {
      'input-part-0': processInputQueue,
      'error-queue-dlq': processErrorQueue
    };

    const handler = queueHandlers[batch.queue];
    if (handler) {
      await handler(batch, env);
    } else {
      console.warn(`[QueueWorker] Unknown queue: ${batch.queue}`);
      batch.messages.forEach(msg => msg.ack());
    }
  }
} as ExportedHandler<Env>;
