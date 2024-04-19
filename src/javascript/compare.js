import { readdir } from 'fs/promises';
import clipboard from 'clipboardy';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DIR = `${__dirname}/../../output`;

/**
 *
 * @param {string} weightList
 */
async function compare(weightList) {
  const files = await readdir(DIR);
  const matchReg = new RegExp(`^.+-\\d+`);

  const prompts = [];
  const weights = weightList.split(',');
  for (const weight of weights) {
    const loraList = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!matchReg.test(file)) {
        continue;
      }

      const loraPrompt = '<lora:' + file.replace('.safetensors', `:${weight}>`);
      loraList.push(loraPrompt);
    }
    const loraPrompts = loraList.join('\n');
    prompts.push(loraPrompts);
    console.log(loraPrompts);
  }

  clipboard.writeSync(prompts.join('\n'));
}

// @ts-ignore
compare(...process.argv.slice(2));
