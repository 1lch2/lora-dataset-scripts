import { readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

export const pruneJson = (folderPath, characterName) => {
  // Get a list of files in the specified folder
  const files = readdirSync(folderPath);
  const jsonFiles = files.filter((file) => file.startsWith('.') && file.endsWith('_meta.json'));

  if (jsonFiles.length === 0) {
    console.log('No unpruned json files.');
    return;
  }

  // Replace underscore with whitespace
  jsonFiles.forEach((filePath) => {
    const jsonData = JSON.parse(readFileSync(join(folderPath, filePath), 'utf-8'));
    const tags = jsonData.tags || {};
    const tagKeys = Object.keys(tags);

    // Add character tag
    tagKeys.splice(1, -2, `${characterName} (arknights)`, 'arknights');

    const newJsonObj = { tags: tagKeys.map((key) => key.replaceAll(/_/g, ' ')) };

    // Rename and write the tags
    const newFilePath = join(folderPath, filePath.replace('_meta.json', '.json').substring(1));
    renameSync(join(folderPath, filePath), newFilePath);
    writeFileSync(newFilePath, JSON.stringify(newJsonObj), 'utf-8');

    console.log('Pruned json: ', newFilePath);
  });
};
