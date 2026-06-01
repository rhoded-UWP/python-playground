# Arcade game thumbnails

Drop a screenshot here for each game and it will automatically replace the
gradient placeholder on that game's card (the card uses `onerror` to fall back
to the placeholder when the image is missing).

## Expected filenames

| Game                          | File                              |
|-------------------------------|-----------------------------------|
| Data Type Catcher             | `data-type-catcher.png`           |
| Python Program Order Challenge| `python-program-order.png`        |
| Cookie Clicker Demo           | `cookie-clicker-demo.png`         |
| Tuple and List Munchers       | `tuple-and-list-munchers.png`     |

## Image guidance

- **Aspect ratio:** 16:10 (the card crops to fill, so close is fine).
- **Suggested size:** ~800×500 px.
- **Format:** PNG or JPG (WebP also works). Keep files reasonably small.
- **Filename:** lowercase, words separated by hyphens, matching the table above.

When you add a new game card in `public/python-arcade.html`, point its
`<img src>` at a new file here following the same naming convention.
