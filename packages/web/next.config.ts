import type { NextConfig } from "next";

const BACKEND = process.env.AI_SERVER_BASE_URL ?? 'http://127.0.0.1:8000';

const nextConfig: NextConfig = {
  async rewrites() {
    // 把这些路径透传给 Python 后端，本地开发和服务器行为一致。
    // 服务器上 Nginx 的 location /api/ 会直接转发，不经过 Next.js，
    // 但本地开发时 Next.js 需要这层 rewrite 才能找到后端。
    return [
      { source: '/api/skills',        destination: `${BACKEND}/api/skills` },
      { source: '/api/models',        destination: `${BACKEND}/api/models` },
      { source: '/api/model',         destination: `${BACKEND}/api/model` },
      { source: '/api/usage',         destination: `${BACKEND}/api/usage` },
      { source: '/api/balance',       destination: `${BACKEND}/api/balance` },
    ];
  },
};

export default nextConfig;
