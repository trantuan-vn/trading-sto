/** @type {import('next').NextConfig} */
const nextConfig = {
  // compiler: {
  //   removeConsole: process.env.NODE_ENV === "production",
  // },
  async redirects() {
    return [
      {
        source: "/dashboard",
        destination: "/dashboard/default",
        permanent: false,
      },
    ];
  },
  reactStrictMode: true,
  // Webpack configuration với cú pháp hiện đại
  webpack: (config, { isServer }) => {
    // Thêm các externals cần thiết
    config.externals.push(
      'pino-pretty',
      'lokijs', 
      'encoding'
    );

    // Tối ưu hóa cho server/client bundle
    if (!isServer) {
      // Client-side optimizations
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }

    return config;
  },

  // Experimental features for Next.js 15
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-icons',
      '@heroicons/react/24/outline',
    ],
    optimizeFonts: true,
  },

  // Logging configuration
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  optimizeFonts: true,  
}

export default nextConfig
