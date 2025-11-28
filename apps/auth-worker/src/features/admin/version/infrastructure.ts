import { UserDO } from '../../ws/infrastructure/UserDO';
import {
  VersionSaveResponse,
  VersionInfo,
  VersionData,
  VersionListResponse,
  IVersionInfrastructureService,
} from './domain';

export function createVersionInfrastructureService(env: Env, userDO: DurableObjectStub<UserDO>): IVersionInfrastructureService {
  
  // Helper method để lấy dữ liệu từ Durable Object
  const executeRepositorySelect = async (sql: string, params: any[] = []): Promise<any[]> => {
    const response = await userDO.fetch('http://user.internal/repository/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params })
    });

    if (!response.ok) {
      throw new Error(`Failed to execute query: ${response.statusText}`);
    }
    
    return await response.json();
  };

  // Helper để lấy tất cả dữ liệu từ các bảng
  const fetchAllTableData = async () => {
    const [pricePolicies, services, vouchers] = await Promise.all([
      executeRepositorySelect('SELECT * FROM price_policies ORDER BY created_at DESC'),
      executeRepositorySelect('SELECT * FROM services ORDER BY created_at DESC'),
      executeRepositorySelect('SELECT * FROM vouchers ORDER BY created_at DESC')
    ]);

    return { pricePolicies, services, vouchers };
  };

  // Helper để quản lý version trong KV
  const getCurrentVersionNumber = async (): Promise<string> => {
    const currentVersion = await env.NONCE_KV.get('version:current');
    return currentVersion || '1';
  };

  const incrementVersionNumber = async (currentVersion: string): Promise<string> => {
    const newVersion = (parseInt(currentVersion) + 1).toString();
    await env.NONCE_KV.put('version:current', newVersion);
    return newVersion;
  };

  // Helper để lưu version data vào R2
  const saveVersionToR2 = async (version: string, data: any): Promise<void> => {
    await env.R2_VERSION_BUCKET.put(
      `version-${version}.json`,
      JSON.stringify(data),
      { httpMetadata: { contentType: 'application/json' } }
    );
  };

  // Helper để lưu version metadata vào KV
  const saveVersionMetadata = async (version: string, data: any, recordCounts: any): Promise<void> => {
    const versionMetadata = {
      version,
      timestamp: data.timestamp,
      dataSize: JSON.stringify(data).length,
      recordCounts
    };
    
    await env.NONCE_KV.put(`version:metadata-${version}`, JSON.stringify(versionMetadata));
  };

  return {
    async saveNewVersion(): Promise<VersionSaveResponse> {
      const currentVersion = await getCurrentVersionNumber();
      const newVersion = await incrementVersionNumber(currentVersion);
      
      // Lấy toàn bộ dữ liệu từ các bảng
      const { pricePolicies, services, vouchers } = await fetchAllTableData();
      
      const recordCounts = {
        price_policies: pricePolicies.length,
        services: services.length,
        vouchers: vouchers.length,
      };

      // Tạo data object để lưu
      const versionData = {
        price_policies: pricePolicies,
        services: services,
        vouchers: vouchers,
        timestamp: new Date().toISOString(),
        version: newVersion
      };

      // Lưu vào R2 và KV
      await Promise.all([
        saveVersionToR2(newVersion, versionData),
        saveVersionMetadata(newVersion, versionData, recordCounts)
      ]);

      return {
        version: newVersion,
        timestamp: versionData.timestamp,
        recordCounts
      };
    },

    async getCurrentVersion(): Promise<VersionInfo> {
      const version = await getCurrentVersionNumber();
      
      // Lấy metadata từ KV
      const metadata = await env.NONCE_KV.get(`version:metadata-${version}`);
      
      if (metadata) {
        const metadataObj = JSON.parse(metadata);
        return {
          version,
          timestamp: metadataObj.timestamp,
          recordCounts: metadataObj.recordCounts
        };
      }

      // Fallback: lấy từ R2 nếu không có metadata
      const object = await env.R2_VERSION_BUCKET.get(`version-${version}.json`);
      if (object) {
        const data = await object.text();
        const versionData = JSON.parse(data);
        return {
          version,
          timestamp: versionData.timestamp
        };
      }

      return { version };
    },

    async getVersionData(versionId: string): Promise<VersionData> {
      const object = await env.R2_VERSION_BUCKET.get(`version-${versionId}.json`);
      
      if (!object) {
        throw new Error(`Version ${versionId} not found`);
      }

      const data = await object.text();
      const versionData = JSON.parse(data);

      return {
        version: versionData.version,
        timestamp: versionData.timestamp,
        data: {
          price_policies: versionData.price_policies,
          services: versionData.services,
          vouchers: versionData.vouchers,
        }
      };
    },

    async getVersionList(): Promise<VersionListResponse> {
      const objects = await env.R2_VERSION_BUCKET.list();
      
      const versions: VersionInfo[] = await Promise.all(
        objects.objects.map(async (object) => {
          const versionId = object.key.replace('version-', '').replace('.json', '');
          
          // Ưu tiên lấy metadata từ KV
          const metadata = await env.NONCE_KV.get(`version:metadata-${versionId}`);
          
          if (metadata) {
            const metadataObj = JSON.parse(metadata);
            return {
              version: versionId,
              timestamp: metadataObj.timestamp,
              recordCounts: metadataObj.recordCounts
            };
          }

          // Fallback: lấy từ R2
          const r2Object = await env.R2_VERSION_BUCKET.get(object.key);
          if (r2Object) {
            const data = await r2Object.text();
            const versionData = JSON.parse(data);
            return {
              version: versionId,
              timestamp: versionData.timestamp
            };
          }

          return { version: versionId };
        })
      );

      // Sort by version number descending
      versions.sort((a, b) => parseInt(b.version) - parseInt(a.version));

      return {
        versions,
        total: versions.length
      };
    },
  };
}