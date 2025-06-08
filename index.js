import fs from "fs";
import readline from "readline";

// Regex to find and extract the phrase part from wrapped patterns (case-insensitive)
const WRAPPED_PHRASE_EXTRACTION_PATTERN =
  /@\[(?:static|static-header)#(.*?)\]/gi;
// Regex to find and remove the entire wrapped pattern (case-insensitive)
const WRAPPED_PATTERN_REMOVAL_PATTERN = /@\[(?:static|static-header)#.*?\]/gi;
// Regex to find HTML-like tags and their content/attributes (e.g., <div class="test">, <img src="x" />)
// This is a simplified regex and might not cover all complex HTML edge cases.
const HTML_TAG_PATTERN = /<[^>]+?>/g; // Matches anything between < and > (non-greedy)

/**
 * Escapes special characters in a string to be safely used in a RegExp constructor.
 * @param {string} string The string to escape.
 * @returns {string} The escaped string.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds phrases that are known to be wrapped (from @[static#...] or @[static-header#...])
 * but appear elsewhere in the document unwrapped, ignoring instances within HTML-like tags.
 *
 * @param {string} filepath The path to the text file.
 * @returns {Promise<Map<string, number[]>>} A Promise that resolves to a Map
 * where keys are the unwrapped phrases and values are arrays of line numbers where they appear.
 */
async function findUnwrappedPhraseOccurrences(filepath) {
  const knownWrappedPhrases = new Set();
  const unwrappedOccurrences = new Map();
  let lineNumber = 0;

  try {
    if (!fs.existsSync(filepath)) {
      console.error(`Error: The file at '${filepath}' does not exist.`);
      process.exit(1);
    }

    // --- Pass 1: Collect all known wrapped phrases ---
    console.log("Pass 1: Collecting phrases from wrapped patterns...");
    let fileStream1 = fs.createReadStream(filepath, { encoding: "utf-8" });
    let rl1 = readline.createInterface({
      input: fileStream1,
      crlfDelay: Infinity,
    });

    for await (const line of rl1) {
      let match;
      WRAPPED_PHRASE_EXTRACTION_PATTERN.lastIndex = 0;
      while ((match = WRAPPED_PHRASE_EXTRACTION_PATTERN.exec(line)) !== null) {
        knownWrappedPhrases.add(match[1]);
      }
    }
    console.log(
      `Found ${knownWrappedPhrases.size} unique phrases in wrapped patterns.`
    );
    if (knownWrappedPhrases.size === 0) {
      console.log(
        "No wrapped phrases found to monitor for unwrapped instances."
      );
      return new Map();
    }

    // --- Pass 2: Search for unwrapped instances of these phrases ---
    console.log(
      "\nPass 2: Searching for unwrapped instances (ignoring HTML tags)..."
    );
    lineNumber = 0;
    let fileStream2 = fs.createReadStream(filepath, { encoding: "utf-8" });
    let rl2 = readline.createInterface({
      input: fileStream2,
      crlfDelay: Infinity,
    });

    for await (const line of rl2) {
      lineNumber++;
      // First, remove the @[static#...] patterns
      let cleanedLine = line.replace(WRAPPED_PATTERN_REMOVAL_PATTERN, "");

      // Second, replace content within HTML tags with spaces
      // This prevents matching phrases inside tag attributes or tag names
      cleanedLine = cleanedLine.replace(HTML_TAG_PATTERN, " ");

      for (const phrase of knownWrappedPhrases) {
        const escapedPhrase = escapeRegExp(phrase);
        const barePhrasePattern = new RegExp(`\\b${escapedPhrase}\\b`, "gi");

        let match;
        barePhrasePattern.lastIndex = 0;
        while ((match = barePhrasePattern.exec(cleanedLine)) !== null) {
          if (!unwrappedOccurrences.has(phrase)) {
            unwrappedOccurrences.set(phrase, []);
          }
          const existingLineNumbers = unwrappedOccurrences.get(phrase);
          if (
            existingLineNumbers[existingLineNumbers.length - 1] !== lineNumber
          ) {
            existingLineNumbers.push(lineNumber);
          }
        }
      }
    }
    return unwrappedOccurrences;
  } catch (error) {
    console.error(
      `An unexpected error occurred while processing '${filepath}': ${error.message}`
    );
    process.exit(1);
  }
}

(async () => {
  const filePath = process.argv[2];

  if (!filePath) {
    console.log("Usage: node index.js <path_to_your_text_file>");
    console.log("\nPlease provide a file path as a command-line argument.");
    process.exit(1);
  }

  console.log(`Searching for unwrapped phrases in: '${filePath}'\n`);
  const foundUnwrappedOccurrences = await findUnwrappedPhraseOccurrences(
    filePath
  );
  processResults(foundUnwrappedOccurrences);
})();

/**
 * Processes and prints the results from the unwrapped phrase occurrences map.
 * @param {Map<string, number[]>} unwrappedOccurrencesMap
 */
function processResults(unwrappedOccurrencesMap) {
  if (unwrappedOccurrencesMap.size > 0) {
    console.log("\n--- Unwrapped Phrase Occurrences Found ---");
    const sortedPhrases = Array.from(unwrappedOccurrencesMap.keys()).sort();

    for (const phrase of sortedPhrases) {
      const lineNumbers = unwrappedOccurrencesMap.get(phrase);
      if (lineNumbers && lineNumbers.length > 0) {
        console.log(
          `Phrase "${phrase}" found unwrapped at lines: ${lineNumbers.join(
            ", "
          )}`
        );
      }
    }
    console.log("----------------------------------------");
  } else {
    console.log("No unwrapped instances of known phrases found.");
  }
}
