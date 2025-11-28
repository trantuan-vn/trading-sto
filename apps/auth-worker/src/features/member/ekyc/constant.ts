export const EKYC_SERVICES = {
  DOCUMENT: {
    RECOGNIZE: {
      path: '/ekyc/recognize-document',
      price: 1000
    }
  },
  FACE: {
    SEARCH: {
      path: '/ekyc/face-search',
      price: 1000
    },
    LIVENESS: {
      path: '/ekyc/face-liveness',
      price: 1000
    },
    VERIFY: {
      path: '/ekyc/face-verify',
      price: 1000
    }
  }
} as const;

export const EKYC_SERVICE_PERMISSIONS = Object.values(EKYC_SERVICES)
  .flatMap(service => Object.values(service))
  .map(service => service.path);