import os

# --- Configuration ---
# The root directory containing character folders.
DATASET_PATH = "./dataset-raw"
# The copyright tag to be used.
COPYRIGHT = "arknights"


def process_text_files_in_dataset(dataset_path, copyright_name):
    """
    Main function to find and process all character folders in the dataset path.
    It will treat each sub-folder in 'dataset_path' as a character folder.
    """
    # 1. Check if the main dataset directory exists.
    if not os.path.isdir(dataset_path):
        print(f"Error: Dataset directory not found at '{dataset_path}'")
        return

    # 2. Treat each subdirectory inside dataset_path as a character folder.
    try:
        character_names = [
            d
            for d in os.listdir(dataset_path)
            if os.path.isdir(os.path.join(dataset_path, d))
        ]
    except FileNotFoundError:
        print(f"Error: Dataset directory not found at '{dataset_path}'")
        return

    if not character_names:
        print(f"Info: No character folders found in '{dataset_path}'.")
        return

    print(f"Found character folders: {', '.join(character_names)}")
    print("-" * 20)

    # 3. Process each character folder.
    for character_name in character_names:
        character_folder_path = os.path.join(dataset_path, character_name)
        print(f"Processing character: '{character_name}'")

        # 4. Use os.walk to recursively find all .txt files.
        # This handles files directly in the character folder and in any subfolders.
        files_processed_count = 0
        for subdir, _, files in os.walk(character_folder_path):
            for file in files:
                if file.endswith(".txt"):
                    file_path = os.path.join(subdir, file)
                    # Process each found text file.
                    _process_single_caption_file(
                        file_path, character_name, copyright_name
                    )
                    files_processed_count += 1

        if files_processed_count == 0:
            print(f"  - No .txt files found for '{character_name}'.")

        print(f"Finished processing for '{character_name}'.\n")

    print("--- All folders processed successfully! ---")


def _process_single_caption_file(file_path, character_name, copyright_name):
    """
    Processes a single .txt caption file. It ensures the character tag
    in the format "{character_name} ({copyright_name})" is at the beginning,
    keeping all other tags in their original order.
    """
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            original_content = f.read()

        # Skip empty or whitespace-only files.
        if not original_content.strip():
            # print(f"  - Skipping empty file: {file_path}")
            return

        # --- Tag Processing Logic ---

        # 1. Define the character tag with copyright.
        char_tag = f"{character_name} ({copyright_name})"

        # 2. Clean up the content (replace underscores with spaces).
        cleaned_content = original_content.replace("_", " ")

        # 3. Split into tags and clean whitespace.
        tags = [tag.strip() for tag in cleaned_content.split(",")]
        tags = list(filter(None, tags))

        # 4. Check if the character tag already exists at the beginning.
        if tags and tags[0] == char_tag:
            # Already has the correct tag at the beginning, no changes needed.
            return

        # 5. Remove the character tag if it exists elsewhere in the list.
        tags = [tag for tag in tags if tag != char_tag]

        # 6. Prepend the character tag at the beginning.
        final_tags = [char_tag] + tags

        # 7. Join the tags back into a single string.
        new_content = ", ".join(final_tags)

        # 8. Write the modified content back to the file only if changes were made.
        if new_content != original_content:
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(new_content)
            print(f"  - Updated: {os.path.relpath(file_path, DATASET_PATH)}")

    except Exception as e:
        print(f"  - ERROR processing file {file_path}: {e}")


# --- Main execution block ---
if __name__ == "__main__":
    # This single function call now handles the entire process.
    process_text_files_in_dataset(DATASET_PATH, COPYRIGHT)
