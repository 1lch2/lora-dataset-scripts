import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * @param {string} folderPath
 */
export const extract2Txt = (folderPath) => {
  // Get a list of files in the specified folder
  const files = readdirSync(folderPath);

  // Process JSON files and create corresponding text files
  files.forEach((file) => {
    if (file.endsWith('.json')) {
      const jsonFilePath = join(folderPath, file);
      const jsonData = JSON.parse(readFileSync(jsonFilePath, 'utf-8'));
      const tags = jsonData.tags || [];

      const txtFilePath = jsonFilePath.replace('.json', '.txt');
      if (tags.length > 0) {
        writeFileSync(txtFilePath, tags.join(', '), 'utf-8');
        console.log(`Tags extracted and written to ${txtFilePath}`);
      } else {
        console.error('No tags detected in file: ', file);
      }
    }
  });
};
