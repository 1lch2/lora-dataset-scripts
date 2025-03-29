import os
import re

DIR = os.path.join(os.path.dirname(__file__), "output")


def extract_number(filename, prefix):
    """Extracts the number from filenames like prefix-00001.safetensors"""
    match = re.search(r"^" + re.escape(prefix) + r"-(\d+)\.safetensors$", filename)
    if match:
        return int(match.group(1))
    # Return a large number for sorting non-matching patterns if needed,
    # but we filter them out beforehand in this logic.
    # Or handle cases where the pattern might slightly differ if necessary.
    return -1  # Should not happen with pre-filtering


def rename():
    try:
        all_files = os.listdir(DIR)
    except FileNotFoundError:
        print(f"Error: Directory not found at {DIR}")
        return
    except Exception as e:
        print(f"Error listing directory {DIR}: {e}")
        return

    files_to_process = [f for f in all_files if f != ".gitkeep"]

    if not files_to_process:
        print("No files to rename in the directory.")
        return

    # Determine prefix robustly
    prefix = None
    for f in files_to_process:
        # Match prefix, optional number, and extension
        match = re.match(r"^(.*?)(?:-\d+)?\.safetensors$", f)
        if match:
            prefix = match.group(1)
            break  # Found prefix

    if prefix is None:
        print(
            "Could not determine file prefix. Ensure files match 'prefix-number.safetensors' or 'prefix.safetensors'."
        )
        return

    numbered_files = []
    unnumbered_file = None
    # Regex to match files with a number like prefix-00001.safetensors
    numbered_regex = re.compile(r"^" + re.escape(prefix) + r"-\d+\.safetensors$")
    # Exact name for the file without a number
    unnumbered_filename = f"{prefix}.safetensors"

    for file_name in files_to_process:
        if numbered_regex.match(file_name):
            numbered_files.append(file_name)
        elif file_name == unnumbered_filename:
            unnumbered_file = file_name
        # else: # Optional: report unexpected files
        #     print(f"Ignoring file with unexpected format: {file_name}")

    # Sort numbered files numerically based on the extracted number
    try:
        numbered_files.sort(key=lambda f: extract_number(f, prefix))
    except Exception as e:
        print(f"Error sorting files: {e}")
        # Decide how to handle: stop, continue with unsorted, etc.
        return  # Stop if sorting fails

    total_files_to_rename = len(numbered_files) + (1 if unnumbered_file else 0)
    if total_files_to_rename == 0:
        print("No files matching the expected patterns found.")
        return

    print(f"Found prefix: {prefix}")
    print(
        f"Renaming {len(numbered_files)} numbered files and {1 if unnumbered_file else 0} unnumbered file."
    )

    # Rename numbered files sequentially from 0
    for i, file_name in enumerate(numbered_files):
        old_path = os.path.join(DIR, file_name)
        new_name = f"{prefix}-{i}.safetensors"
        new_path = os.path.join(DIR, new_name)

        # Avoid renaming if old and new names are the same (e.g., prefix-0.safetensors already exists)
        if old_path == new_path:
            print(f"Skipping rename for {file_name} (already correct).")
            continue

        print(f"Renaming {file_name} to {new_name}")
        try:
            os.rename(old_path, new_path)
        except OSError as e:
            print(f"Error renaming {file_name} to {new_name}: {e}")
            # Consider whether to stop or continue on error
        except Exception as e:
            print(f"Unexpected error renaming {file_name}: {e}")

    # Rename the unnumbered file to the last index
    if unnumbered_file:
        old_path = os.path.join(DIR, unnumbered_file)
        # The index for the last file is total_files_to_rename - 1
        last_index = total_files_to_rename - 1
        new_name = f"{prefix}-{last_index}.safetensors"
        new_path = os.path.join(DIR, new_name)

        if old_path == new_path:
            print(f"Skipping rename for {unnumbered_file} (already correct).")
        else:
            print(f"Renaming {unnumbered_file} to {new_name}")
            try:
                os.rename(old_path, new_path)
            except OSError as e:
                print(f"Error renaming {unnumbered_file} to {new_name}: {e}")
            except Exception as e:
                print(f"Unexpected error renaming {unnumbered_file}: {e}")

    print("Renaming process finished.")


if __name__ == "__main__":
    rename()
