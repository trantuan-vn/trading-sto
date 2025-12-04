import { UserDO } from '../../ws/infrastructure/UserDO';
import {
  VersionSaveResponse,
  VersionInfo,
  VersionData,
  VersionListResponse,
  IVersionInfrastructureService, VersionInfoSchema
} from './domain';

import { executeUtils } from '../../../shared/utils';
const executeRepositoryAction = executeUtils.executeRepositoryAction;
const executeRepositorySelect = executeUtils.executeRepositorySelect;
const executeDynamicAction = executeUtils.executeDynamicAction;

export function createVersionInfrastructureService(env: Env, userDO: DurableObjectStub<UserDO>): IVersionInfrastructureService {
  
  // Helper method để lấy dữ liệu từ Durable Object

  // Helper để lấy tất cả dữ liệu từ các bảng
  const fetchAllTableData = async () => {
    const [pricePolicies, services, vouchers] = await Promise.all([
      executeRepositorySelect(userDO, 'SELECT * FROM price_policies ORDER BY created_at DESC'),
      executeRepositorySelect(userDO, 'SELECT * FROM services ORDER BY created_at DESC'),
      executeRepositorySelect(userDO, 'SELECT * FROM vouchers ORDER BY created_at DESC')
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
      await saveVersionToR2(newVersion, versionData);

      const version = VersionInfoSchema.parse({
        version: newVersion,
        timestamp: versionData.timestamp,
        recordCounts
      });
      await executeRepositoryAction(userDO, 'create', version, 'versions');

      return {
        version: newVersion,
        timestamp: versionData.timestamp,
        recordCounts
      };
    },

    async upgradeVersion(): Promise<VersionInfo> {
      const version = await getCurrentVersionNumber();
      
      const versions = await executeRepositorySelect(
        userDO, 
        'SELECT version FROM versions where version = (select max(version) from versions)'
      );
      
      if (versions.length > 0 && (versions[0].version !== version)) {
        const object = await env.R2_VERSION_BUCKET.get(`version-${version}.json`);
        
        if (object) {
          const data = await object.text();
          const versionData = JSON.parse(data);
          
          // Tạo operations cho multi-table
          const operations = [];
          
          // Xử lý price_policies
          if (versionData.price_policies && Array.isArray(versionData.price_policies)) {
            // Thêm lệnh delete trước khi insert
            operations.push({
              table: 'price_policies',
              operation: 'delete',
              data: {} // Có thể thêm điều kiện nếu cần
            });
            
            // Thêm operations insert cho price_policies
            versionData.price_policies.forEach( (policy : any) => {
              operations.push({
                table: 'price_policies',
                operation: 'insert',
                data: policy
              });
            });
          }
          
          // Xử lý services
          if (versionData.services && Array.isArray(versionData.services)) {
            // Thêm lệnh delete trước khi insert
            operations.push({
              table: 'services',
              operation: 'delete',
              data: {} // Có thể thêm điều kiện nếu cần
            });
            
            // Thêm operations insert cho services
            versionData.services.forEach( (service : any) => {
              operations.push({
                table: 'services',
                operation: 'insert',
                data: service
              });
            });
          }
          
          // Xử lý vouchers
          if (versionData.vouchers && Array.isArray(versionData.vouchers)) {
            // Thêm lệnh delete trước khi insert
            operations.push({
              table: 'vouchers',
              operation: 'delete',
              data: {} // Có thể thêm điều kiện nếu cần
            });
            
            // Thêm operations insert cho vouchers
            versionData.vouchers.forEach( (voucher : any) => {
              operations.push({
                table: 'vouchers',
                operation: 'insert',
                data: voucher
              });
            });
          }
          
          // Thực hiện multi-table operations nếu có
          if (operations.length > 0) {
            await executeDynamicAction(userDO, 'multi-table', {
              operations: operations
            });            
          }
        }
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
      const versions = await executeRepositorySelect(userDO, 'SELECT * FROM versions ORDER BY version DESC');
      return {
        versions,
        total: versions.length
      };
    },
  };
}