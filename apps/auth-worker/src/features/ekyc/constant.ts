// constant.ts

export const EKYC_SERVICES = {
  DOCUMENT: {
    RECOGNIZE: {
      path: '/ekyc/recognize-document',
      price: 1000 // VND per request
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

export const EKYC_SERVICE_PERMISSIONS = [
  EKYC_SERVICES.DOCUMENT.RECOGNIZE.path,
  EKYC_SERVICES.FACE.SEARCH.path,
  EKYC_SERVICES.FACE.LIVENESS.path,
  EKYC_SERVICES.FACE.VERIFY.path
];
