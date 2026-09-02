// decrypt_log_file.js – Decrypt AES-256-CTR logs
// Usage: node decrypt_log_file.js <log_file_path>
// Environment: ENCRYPTION_KEY (must match proxy server key)
import { readFileSync, existsSync } from 'fs';
import { createDecipheriv } from 'crypto';

// Read encryption key from environment (or fallback – never hardcode)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

if (!ENCRYPTION_KEY) {
  console.error('Error: ENCRYPTION_KEY environment variable not set.');
  process.exit(1);
}

const args = process.argv;
if (args.length !== 3) {
  console.error(`Usage: ${args[0]} ${args[1]} <log_file_path>`);
  process.exit(1);
}

const logFile = args[2];
const decrypted = parseLogFile(logFile);
console.log(decrypted);

function decodeEntry(ivHex, dataHex) {
  try {
    const decipher = createDecipheriv('aes-256-ctr', ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'));
    let decrypted = decipher.update(dataHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    throw new Error(`Decryption failed: ${e.message}`);
  }
}

function parseLogFile(filePath) {
  try {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const lines = readFileSync(filePath, 'utf8').split('\n').filter(line => line.trim());
    let output = '';
    for (const line of lines) {
      const entry = JSON.parse(line);
      // Each line is { iv: "hex", data: "hex" }
      const entries = Object.entries(entry);
      for (const [iv, encrypted] of entries) {
        output += decodeEntry(iv, encrypted) + '\n';
      }
    }
    return output;
  } catch (e) {
    console.error('Error:', e.message);
  }
}
