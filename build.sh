#!/bin/sh
# build.sh — Cloudflare Pages build script
# Generates config.js from environment variables set in Cloudflare dashboard.

node -e "
var fs = require('fs');
var url = process.env.SUPABASE_URL;
var key = process.env.SUPABASE_KEY;
if (!url || !key) { console.error('ERROR: SUPABASE_URL or SUPABASE_KEY env var is missing!'); process.exit(1); }
fs.writeFileSync('config.js',
  'export const SUPABASE_URL = \"' + url + '\";\n' +
  'export const SUPABASE_KEY = \"' + key + '\";\n'
);
console.log('config.js generated OK');
"
