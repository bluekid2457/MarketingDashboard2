/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/landingPages/index.html',
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
