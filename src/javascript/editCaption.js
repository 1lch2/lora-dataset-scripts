import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { getPath } from '../utils/getPath.js';
import { join } from 'path';

const DATASET_PATH = getPath('./dataset-raw');

/**
 * @param {string} folderPath
 * @param {string[]} characterNames
 */
const editCaption = (folderPath, characterNames) => {
  characterNames.forEach((characterName) => {
    // Get a list of files in the specified folder
    const files = readdirSync(join(folderPath, characterName));
    files.forEach((file) => {
      if (file.endsWith('.txt')) {
        const tagFilePath = join(folderPath, characterName, file);
        const tagFile = readFileSync(tagFilePath, 'utf-8');
        const tagList = tagFile.split(', ');
        const newTags = tagList.map((tag) => tag.replaceAll('_', ' '));
        newTags.splice(1, -2, `${characterName} (arknights)`, 'arknights');

        // Move 1girl tag to the front
        const oneGirlTag = newTags.indexOf('1girl');
        const twoGirlsTag = newTags.indexOf('2girls');
        if (oneGirlTag !== 0 && oneGirlTag !== -1 && twoGirlsTag === -1) {
          newTags.splice(oneGirlTag, 1);
          newTags.splice(0, -1, '1girl');
        }

        writeFileSync(tagFilePath, newTags.join(', '), 'utf-8');

        console.log('Write tag file: ', tagFile);
      }
    });
  });

  console.log('Edit tag files complete');
};

editCaption(DATASET_PATH, readdirSync(DATASET_PATH));
