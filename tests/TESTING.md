# Testing Guide for Klaro Element Tracking

## Test Summary

| Test Suite                     | Tests | Status |
| ------------------------------ | ----- | ------ |
| Unit Tests (Vitest)            | 158   | ✅     |
| Integration Tests (Playwright) | 17    | ✅     |

## Running Tests

```bash
# Unit tests (fingerprinting, matching, similarity)
pnpm test

# Integration tests (browser automation against test-site)
pnpm run test:integration

# Integration tests with UI
pnpm run test:integration:ui
```

## Manual Testing Checklist

To manually test the extension with the test-site:

### Setup

1. Build the extension:

   ```bash
   pnpm build
   ```

2. Load in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select `.output/chrome-mv3` folder

3. Start the test-site:

   ```bash
   cd test-site && npm run dev
   ```

4. Open http://localhost:5173 in Chrome

### Test Scenarios

#### Basic Tracking

- [ ] Load test-site, verify all buttons appear in sidebar
- [ ] Click CTA button from sidebar, verify modal opens
- [ ] Click tab buttons from sidebar, verify tab switching

#### CTA Text Rotation (6s interval)

- [ ] Wait 6 seconds (CTA text rotates: "Register Now" → "Join Now" → etc.)
- [ ] Verify CTA button still clickable from sidebar
- [ ] Verify click still opens modal

#### Sponsor Shuffle + RenderKey (8s interval)

- [ ] Wait 8 seconds (sponsors shuffle, complete DOM reconstruction)
- [ ] Verify all interactive elements still tracked
- [ ] Verify clicks still work after shuffle

#### Stats Order Shuffle (10s interval)

- [ ] Wait 10 seconds (attendees/countdown/CTA reorder)
- [ ] Verify elements tracked correctly despite position changes

#### Modal Form

- [ ] Open modal, verify form elements appear in sidebar
- [ ] Close modal, verify form elements marked as lost/unavailable
- [ ] Reopen modal, verify form elements re-identified

#### Placeholder Rotation (7s interval)

- [ ] Open modal, wait 7 seconds
- [ ] Verify form inputs still functional after placeholder changes

#### Tab Persistence

- [ ] Switch to another Chrome tab
- [ ] Switch back
- [ ] Verify tracking state restored (via chrome.storage.session)

#### Debug Mode

- [ ] Enable debug mode (send `SET_DEBUG_MODE` message)
- [ ] Verify overlay shows confidence scores
- [ ] Verify color coding: green (>0.8), yellow (0.6-0.8), red (<0.6)

#### Page Reload

- [ ] Reload page
- [ ] Verify fresh tracking starts correctly

### Performance Checks

Open Chrome DevTools → Performance tab:

- [ ] Re-identification completes in <50ms after DOM change
- [ ] MutationObserver callback <10ms per batch
- [ ] No memory leaks (stable memory over time)

## Test Site Challenges

The test-site (`test-site/`) is designed to stress-test element tracking with:

| Challenge             | Interval     | Description                                       |
| --------------------- | ------------ | ------------------------------------------------- |
| CSS-in-JS classes     | Every render | Random class suffixes (e.g., `_cta_1a2b`)         |
| CTA text rotation     | 6s           | Button text changes completely                    |
| Placeholder rotation  | 7s           | Form placeholders change                          |
| Sponsor shuffle       | 8s           | Complete DOM reconstruction via `key={renderKey}` |
| Stats order shuffle   | 10s          | Elements change visual position                   |
| Countdown timer       | 1s           | Frequent state updates                            |
| Announcement rotation | 4s           | Banner content changes                            |
| Attendee count        | 5s           | Number updates trigger re-render                  |

## Troubleshooting

### Tests fail with "Test-site not running"

Start the test-site: `cd test-site && npm run dev`

### Playwright tests show blank page

Ensure the test-site is running on http://localhost:5173

### Unit tests fail with Playwright error

Check vitest.config.ts excludes `tests/integration/**`
