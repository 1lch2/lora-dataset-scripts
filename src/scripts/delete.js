import fs from 'fs';
import path from 'path';

export const deleteOrphanedJson = (folderPath) => {
  // Get a list of files in the specified folder
  const files = fs.readdirSync(folderPath);

  // Separate files into json and png lists
  const jsonFiles = files.filter((file) => file.startsWith('.') && file.endsWith('_meta.json'));
  const pngFiles = files.filter((file) => file.endsWith('.png'));

  // Find orphaned json files
  const orphanedJsonFiles = jsonFiles.filter(
    (jsonFile) => !pngFiles.includes(jsonFile.slice(1, -10) + '.png')
  );

  if (orphanedJsonFiles.length === 0) {
    console.log('No orphaned json files.');
    return;
  }

  // Delete orphaned json files
  orphanedJsonFiles.forEach((orphanedJsonFile) => {
    const orphanedJsonPath = path.join(folderPath, orphanedJsonFile);
    fs.unlinkSync(orphanedJsonPath);
    console.log(`Deleted orphaned json file: ${orphanedJsonPath}`);
  });
  console.log(`\nDeleted ${orphanedJsonFiles.length} files.\n`);
};
