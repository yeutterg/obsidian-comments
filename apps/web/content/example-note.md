---
publish: true
visibility: public
comments: true
editing: false
---

# Welcome to Obsidian Comments

This is an example note published from your Obsidian vault. You can select any text on this page to leave an anchored comment.

## How It Works

1. **Write** your notes in Obsidian as usual
2. **Publish** by adding `publish: true` to the frontmatter
3. **Share** the URL with collaborators
4. **Comment** by selecting text and clicking the comment button

## Features

- Inline anchored comments tied to specific text
- Comments stored as adjacent markdown files
- Light and dark theme support
- Password protection for private notes
- No database required — Git-first storage

## Example Content

Here is some example content that you can try commenting on. Select any passage of text and a comment button will appear. Comments are displayed in the sidebar panel on the right.

> "The best way to predict the future is to invent it." — Alan Kay

### Code Example

```javascript
function publishNote(note) {
  if (note.frontmatter.publish) {
    return renderMarkdown(note.content);
  }
  return null;
}
```

### Table Example

| Feature | Status |
|---------|--------|
| Publishing | Done |
| Comments | Done |
| Password Protection | Done |
| Theme Toggle | Done |

---

*This note was published using Obsidian Comments.*
