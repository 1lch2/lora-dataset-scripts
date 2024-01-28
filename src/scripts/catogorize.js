import { readFileSync, readdirSync, writeFileSync } from 'fs';
import fs from 'fs';
import { getPath } from '../utils/getPath.js';
import { join } from 'path';

const classfiedFolderPath = getPath('dataset-classfied');

const clearFolder = (folderPath) => {
  const files = readdirSync(folderPath);
  files.forEach((file) => {
    const filePath = `${folderPath}/${file}`;
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      clearFolder(filePath);
    } else {
      fs.unlinkSync(filePath);
      console.log('Removed file: ', filePath);
    }
  });
};

/**
 *
 * @param {string} folderPath
 * @param {string[][]} category
 */
const classify = (folderPath, category) => {
  const files = fs.readdirSync(folderPath);

  // Separate files into json and png lists
  const jsonFiles = files.filter((file) => file.endsWith('.json'));
  const pngFiles = files.filter((file) => file.endsWith('.png'));

  const filesClassified = new Array(category.length).fill([]);
  jsonFiles.forEach((file) => {
    const jsonData = JSON.parse(readFileSync(join(folderPath, file), 'utf-8'));
    const tags = jsonData.tags || [];

    if (tags.length === 0) {
      return;
    }

    // Check each category for this json file
    category.forEach((cat, index) => {
      // If this json includes all the tags required, add it to classified.
      let flag = true;
      cat.forEach((tag) => {
        flag = flag && tags.includes(tag);
      });

      if (flag) {
        filesClassified[index].push(file);
      }
    });
  });
};

const folderPath = getPath('./dataset-raw');

// TODO: not tested

classify(folderPath, [['official alternate costume', 'red dress']]);
