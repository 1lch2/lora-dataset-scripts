export function readImageData(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(Error('无法读取所选图片'));
    reader.readAsDataURL(file);
  });
}
