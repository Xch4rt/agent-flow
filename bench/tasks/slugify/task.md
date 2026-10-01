Implement `slugify(title, options?)` in `src/slugify.js` (ES module, no dependencies).

Requirements:
- Lowercase ASCII output; letters with accents are folded to their base letter ("Canción" → "cancion", "Ñandú" → "nandu").
- Any run of characters that are not a-z or 0-9 becomes a single "-"; no leading or trailing "-".
- `options.maxLength` (default 60): cut at a word boundary so the slug never exceeds it and never ends with "-". If the first word alone is longer, hard-cut it.
- `options.separator` (default "-"): use it instead of "-" everywhere.
- Non-string input throws a `TypeError`.
- Empty or all-symbol input returns "".

Add your own tests in `test/`. `npm test` must pass.
