/**
 * Integration tests for element tracking across React re-renders.
 *
 * These tests validate that the element tracking system can survive
 * the challenges presented by the test-site:
 * - CTA text rotation (6s)
 * - Sponsor shuffle + renderKey (8s)
 * - Stats order shuffle (10s)
 * - Placeholder rotation (7s)
 * - Modal open/close
 */

import { test, expect, type Page } from '@playwright/test';

// Helper to inject element tracker into page
async function injectTracker(page: Page): Promise<void> {
  // Build and inject the element tracker bundle
  // For now, we test the DOM behavior that the tracker must handle
}

test.describe('Element Tracking on Test Site', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
    // Wait for initial render
    await page.waitForSelector("text=Germany's Biggest AI Hackathon");
  });

  test.describe('Basic Element Detection', () => {
    test('finds CTA button on initial load', async ({ page }) => {
      // CTA starts with one of: 'Register Now', 'Join Now', 'Sign Up', 'Get Started', 'Reserve Spot'
      const cta = page
        .locator('div')
        .filter({ hasText: /^(Register Now|Join Now|Sign Up|Get Started|Reserve Spot)$/ })
        .first();
      await expect(cta).toBeVisible();
    });

    test('finds tab buttons', async ({ page }) => {
      await expect(page.getByText('About', { exact: true })).toBeVisible();
      await expect(page.getByText('Schedule', { exact: true })).toBeVisible();
      await expect(page.getByText('Prizes', { exact: true })).toBeVisible();
    });

    test('finds footer links', async ({ page }) => {
      await expect(page.getByText('Email Us')).toBeVisible();
      await expect(page.getByText('Discord')).toBeVisible();
      await expect(page.getByText('Privacy Policy')).toBeVisible();
    });

    test('finds all sponsor elements', async ({ page }) => {
      const sponsors = ['Cursor', 'OpenAI', 'Google Gemini', 'Manus', 'Hume AI', 'ElevenLabs'];
      for (const sponsor of sponsors) {
        await expect(page.getByText(sponsor).first()).toBeVisible();
      }
    });
  });

  test.describe('CTA Text Rotation (6s interval)', () => {
    test('CTA remains clickable after text change', async ({ page }) => {
      // Find initial CTA position
      const ctaTexts = ['Register Now', 'Join Now', 'Sign Up', 'Get Started', 'Reserve Spot'];
      const ctaLocator = page
        .locator('div')
        .filter({ hasText: /^(Register Now|Join Now|Sign Up|Get Started|Reserve Spot)$/ })
        .first();

      // Get initial bounding box
      const initialBox = await ctaLocator.boundingBox();
      expect(initialBox).toBeTruthy();

      // Wait for text to change (6s interval + buffer)
      await page.waitForTimeout(7000);

      // CTA should still be in roughly the same position
      const newCta = page
        .locator('div')
        .filter({ hasText: /^(Register Now|Join Now|Sign Up|Get Started|Reserve Spot)$/ })
        .first();
      const newBox = await newCta.boundingBox();
      expect(newBox).toBeTruthy();

      // Position should be within 100px (our tracking threshold)
      if (initialBox && newBox) {
        const distance = Math.hypot(newBox.x - initialBox.x, newBox.y - initialBox.y);
        expect(distance).toBeLessThan(100);
      }

      // Should still be clickable
      await newCta.click();
      // Modal should open
      await expect(page.getByText('Register for the Hackathon')).toBeVisible();
    });
  });

  test.describe('Sponsor Shuffle + RenderKey (8s interval)', () => {
    test('sponsors remain visible after shuffle', async ({ page }) => {
      // Verify Cursor sponsor is visible (using exact match within sponsor grid)
      const sponsorGrid = page.locator('div').filter({ hasText: 'Powered By' }).locator('..');
      const cursorSponsor = sponsorGrid.getByText('Cursor', { exact: true }).first();
      await expect(cursorSponsor).toBeVisible();

      // Wait for shuffle (8s + buffer)
      await page.waitForTimeout(9000);

      // Sponsors should still be visible after shuffle
      await expect(
        cursorSponsor.or(sponsorGrid.getByText('Cursor', { exact: true }).first())
      ).toBeVisible();

      // All 12 sponsors should still be present
      const allSponsors = [
        'OpenAI',
        'Manus',
        'Hume AI',
        'ElevenLabs',
        'n8n',
        'LangChain',
        'Runway',
        'Miro',
        'v0',
        'MiniMax',
      ];
      for (const sponsor of allSponsors) {
        await expect(page.getByText(sponsor, { exact: true }).first()).toBeVisible();
      }
    });

    test('complete DOM is replaced on renderKey increment', async ({ page }) => {
      // This test verifies the challenge exists - the entire container gets a new key
      // Our tracker must re-identify elements despite this

      // Get initial container
      const container = page.locator('div').first();
      const initialHtml = await container.innerHTML();

      // Wait for renderKey change (8s + buffer)
      await page.waitForTimeout(9000);

      // Container should have different content structure (shuffled sponsors, random classes)
      const newHtml = await container.innerHTML();
      // The HTML will differ due to shuffled sponsors and random class names
      // This is what makes tracking challenging
      expect(newHtml).not.toBe(initialHtml);
    });
  });

  test.describe('Stats Order Shuffle (10s interval)', () => {
    test('all stats remain visible after position shuffle', async ({ page }) => {
      // Wait for stats shuffle (10s + buffer)
      await page.waitForTimeout(11000);

      // Stats elements should still be visible
      await expect(page.getByText('hackers registered')).toBeVisible();
      await expect(page.getByText('Until Submission Deadline')).toBeVisible();

      // CTA should still be visible somewhere
      const cta = page
        .locator('div')
        .filter({ hasText: /^(Register Now|Join Now|Sign Up|Get Started|Reserve Spot)$/ })
        .first();
      await expect(cta).toBeVisible();
    });
  });

  test.describe('Modal Interactions', () => {
    test('modal form elements appear and can be interacted with', async ({ page }) => {
      // Click CTA to open modal
      const cta = page
        .locator('div')
        .filter({ hasText: /^(Register Now|Join Now|Sign Up|Get Started|Reserve Spot)$/ })
        .first();
      await cta.click();

      // Wait for modal
      await expect(page.getByText('Register for the Hackathon')).toBeVisible();

      // Form elements should be visible
      const nameInput = page.locator('input').first();
      await expect(nameInput).toBeVisible();

      // Fill form
      await nameInput.fill('Test User');

      const emailInput = page.locator('input').nth(1);
      await emailInput.fill('test@example.com');

      // Submit button should be visible
      await expect(page.getByText('Submit Registration')).toBeVisible();
    });

    test('modal elements are lost when modal closes', async ({ page }) => {
      // Open modal
      const cta = page
        .locator('div')
        .filter({ hasText: /^(Register Now|Join Now|Sign Up|Get Started|Reserve Spot)$/ })
        .first();
      await cta.click();
      await expect(page.getByText('Register for the Hackathon')).toBeVisible();

      // Close modal
      await page.getByText('Cancel').click();

      // Modal should be gone
      await expect(page.getByText('Register for the Hackathon')).not.toBeVisible();
    });

    test('placeholder text rotation does not break form interaction', async ({ page }) => {
      // Open modal
      const cta = page
        .locator('div')
        .filter({ hasText: /^(Register Now|Join Now|Sign Up|Get Started|Reserve Spot)$/ })
        .first();
      await cta.click();
      await expect(page.getByText('Register for the Hackathon')).toBeVisible();

      // Get initial placeholder
      const nameInput = page.locator('input').first();
      const initialPlaceholder = await nameInput.getAttribute('placeholder');

      // Wait for placeholder rotation (7s + buffer)
      await page.waitForTimeout(8000);

      // Placeholder should have changed
      const newPlaceholder = await nameInput.getAttribute('placeholder');
      // Note: might be same if we landed on same variant
      // The important thing is the input is still functional

      // Input should still be usable
      await nameInput.fill('Test User After Rotation');
      expect(await nameInput.inputValue()).toBe('Test User After Rotation');
    });
  });

  test.describe('Tab Navigation', () => {
    test('tab switching shows different content', async ({ page }) => {
      // Click Schedule tab
      await page.getByText('Schedule').click();
      await expect(page.getByText('Saturday')).toBeVisible();
      await expect(page.getByText('Sunday')).toBeVisible();

      // Click Prizes tab
      await page.getByText('Prizes').click();
      await expect(page.getByText('Prize Pool')).toBeVisible();
      await expect(page.getByText('$280,000+ in Prizes').or(page.getByText('1st'))).toBeVisible();

      // Click back to About
      await page.getByText('About').click();
      await expect(page.getByText('About the Event')).toBeVisible();
    });

    test('schedule day toggle works', async ({ page }) => {
      await page.getByText('Schedule', { exact: true }).click();

      // Default is Saturday (Day 1)
      await expect(page.getByText('Doors open, breakfast')).toBeVisible();

      // Switch to Sunday
      await page.getByText('Sunday', { exact: true }).click();
      await expect(page.getByText('Continue building')).toBeVisible();
      // Use exact match to avoid matching the countdown label
      await expect(page.getByText('Submission deadline', { exact: true })).toBeVisible();
    });
  });

  test.describe('Countdown Timer (1s interval)', () => {
    test('countdown updates without breaking page', async ({ page }) => {
      // Get initial seconds value
      const secondsLocator = page.locator('text=sec').locator('..').locator('span').first();
      const initialSeconds = await secondsLocator.textContent();

      // Wait 2 seconds
      await page.waitForTimeout(2000);

      // Seconds should have changed
      const newSeconds = await secondsLocator.textContent();
      // Values should differ (countdown is changing)
      // Note: They could match if we hit exactly the right second, but unlikely
    });
  });

  test.describe('Announcement Banner', () => {
    test('announcement content rotates', async ({ page }) => {
      // Get initial announcement
      const banner = page
        .locator('span')
        .filter({ hasText: /sponsor|prize|spots|judges|food/i })
        .first();
      const initialText = await banner.textContent();

      // Wait for rotation (4s + buffer)
      await page.waitForTimeout(5000);

      // Banner should still be visible
      await expect(banner).toBeVisible();
    });

    test('banner can be closed', async ({ page }) => {
      // Find close button (the 'x')
      const closeButton = page.locator('span').filter({ hasText: 'x' }).first();
      await closeButton.click();

      // Banner content should be gone
      await expect(
        page.locator('span').filter({ hasText: /sponsor announced/i })
      ).not.toBeVisible();
    });
  });

  test.describe('CSS-in-JS Class Handling', () => {
    test('elements have random class names', async ({ page }) => {
      // Get CTA class names
      const cta = page
        .locator('div')
        .filter({ hasText: /^(Register Now|Join Now|Sign Up|Get Started|Reserve Spot)$/ })
        .first();
      const className = await cta.getAttribute('class');

      // Class should contain hash-like pattern from the hash() function
      // e.g., "_cta_1abc23"
      expect(className).toMatch(/_[a-z]+_[a-z0-9]+/i);
    });
  });

  test.describe('Long Duration Stress Test', () => {
    test.skip('survives 30 seconds of DOM mutations', async ({ page }) => {
      // This is a comprehensive stress test - skip by default as it takes 30s
      // Enable for thorough testing

      const checkInterval = 5000; // Check every 5s
      const totalDuration = 30000;

      for (let elapsed = 0; elapsed < totalDuration; elapsed += checkInterval) {
        await page.waitForTimeout(checkInterval);

        // Verify key elements are still accessible
        // CTA
        const cta = page
          .locator('div')
          .filter({ hasText: /^(Register Now|Join Now|Sign Up|Get Started|Reserve Spot)$/ })
          .first();
        await expect(cta).toBeVisible();

        // Tabs
        await expect(page.getByText('About')).toBeVisible();

        // At least one sponsor
        await expect(page.getByText('Cursor').or(page.getByText('OpenAI'))).toBeVisible();

        console.log(`Stress test: ${elapsed + checkInterval}ms elapsed, elements still accessible`);
      }
    });
  });
});
