# zolwie-losowanie

A classroom response and turtle racing application for teachers and students.

## Features

### Authentication & Registration
- Auto-open login menu for unauthenticated users
- Role selection: "Uczeń" (Student) / "Nauczyciel" (Teacher)
- URL parameter `?code=` to prefill registration join key
- Registration with teacher codes or self-registration

### Class Management
- Create, delete, and switch classes
- Double-confirmation for class deletion
- Refresh button in menu for both roles

### Student Management
- Display name editing with teacher approval workflow
- Name change requests: `request-name-change` → `decide-name-request`
- My pending requests view for students
- Student points tracking (plus/minus counts)

### Character System
- 7 selectable characters: adventurer, cat, demon, girl, knight, samurai, turtle
- Per-character configuration in `images/characters/*/config.json`:
  - `zoom`: scaling factor
  - `flipX`/`flipY`: horizontal/vertical flip
  - `offsetX`/`offsetY`: position offset
- FPS control per character (8, 10, 6, 12, 8, 12, 1)
- Character renders with `transform: translate(offsetX,offsetY) scale(zoom*(flip?-1:1))`
- `image-rendering: pixelated` for crisp scaling

### Turtle Racing
- Race with student avatars moving along track
- Per-student speed (random or constant "test mode")
- Winner determination and animation
- Student markings: +, −, nb during/after race

### QR Code System
- Generate QR codes for class join keys
- Multi-use QR codes (one active at a time, auto-deleted on close)
- Copy-to-clipboard with fallback textarea for non-HTTPS
- Delete QR codes from teacher interface

### Name Change Approval Workflow
- Students can request display name changes
- Teachers see pending requests in sidebar
- Approve/reject with decision tracking
- Students can view their own pending requests

### Technical Details
- **Backend**: PHP with SQLite/MySQL support
- **Migrations**: `ensureSchema()` handles table creation and column additions
- **Frontend**: Vanilla JavaScript, no build step required
- **Encoding**: UTF-8 without BOM, Polish characters fixed
- **CSS**: Vendor prefixes, `image-rendering: pixelated`, `transform-origin: center`

## Project Structure

```
images/characters/*/      # Character folders with PNG sprites and config.json
  adventurer/              # zoom:2, fps:8
  cat/                     # zoom:1.5, flipX:true, fps:10
  demon/                   # zoom:1, flipX:true, fps:6
  girl/                    # zoom:1.2, flipX:true, fps:12
  knight/                  # zoom:1.5, fps:8
  samurai/                 # zoom:2, offsetY:-70, fps:12
  turtle/                  # zoom:1, fps:1 (built-in)

api/auth.php               # PHP backend with all API endpoints
script.js                  # Core frontend logic
index.html                 # Main HTML structure
styles.css                 # Styling with pixelated rendering
temp.html                  # Test fixture
```

## Development

- Run `node --check script.js` to verify JavaScript syntax
- Run `php -l api/auth.php` to verify PHP syntax
- All recent edits have been verified syntax-ok
- Version tracking: styles.css v92, script.js v92, index.html v92

## License

MIT License