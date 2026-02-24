const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
const envPath = path.join(__dirname, '.env');
const envVars = {};

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        envVars[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
}

module.exports = {
  apps: [
    {
      name: 'aisales',
      script: 'dist/index.cjs',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
        ...envVars
      },
      error_file: path.join(__dirname, '../logs/error.log'),
      out_file: path.join(__dirname, '../logs/out.log'),
      log_file: path.join(__dirname, '../logs/combined.log'),
      time: true
    },
    {
      name: 'worker-price-lookup',
      script: 'npm',
      args: 'run worker:price-lookup',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production', ...envVars },
      error_file: path.join(__dirname, '../logs/worker-price-lookup-error.log'),
      out_file: path.join(__dirname, '../logs/worker-price-lookup-out.log'),
      time: true
    },
    {
      name: 'podzamenu-service',
      script: 'podzamenu_lookup_service.py',
      interpreter: 'python3',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: { PORT: '8200', ...envVars },
      error_file: path.join(__dirname, '../logs/podzamenu-error.log'),
      out_file: path.join(__dirname, '../logs/podzamenu-out.log'),
      time: true
    }
  ]
};
