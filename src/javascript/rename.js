import { readdir, rename as fileRename } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DIR = `${__dirname}/../../output`;

async function rename() {
  const files = await readdir(DIR);
  if (files[0] === '.keep') {
    files.shift();
  }

  const regex = new RegExp(`\\.safetensors$`);
  const prefix = files[0].split('-')[0];

  for (let i = 0; i < files.length; i++) {
    const fileName = files[i];
    if (!regex.test(fileName)) {
      continue;
    }

    const newName = fileName.replace(prefix, `${prefix}-___`).replace(/___.*/, `${i}.safetensors`);

    console.log(newName);
    fileRename(`${DIR}/${fileName}`, `${DIR}/${newName}`);
  }
}

rename();
