import { getPath } from '../utils/getPath.js';
import { readdirSync } from 'fs';
import { join } from 'path';
import { deleteOrphanedJson } from '../scripts/delete.js';
import { pruneJson } from '../scripts/prune.js';
import { extract2Txt } from '../scripts/extract2Txt.js';

const DATASET_PATH = getPath('./dataset-raw');

const main = () => {
  const dirs = readdirSync(DATASET_PATH);
  dirs.forEach((dirName) => {
    const characterName = dirName;
    const nextFolderPath = join(DATASET_PATH, dirName);

    // Remove unpaired json
    deleteOrphanedJson(nextFolderPath);

    // Prune json files
    pruneJson(nextFolderPath, characterName);

    // Extract TXT
    extract2Txt(nextFolderPath);

    console.log('\nFinished processing ', dirName);
  });
};

main();
