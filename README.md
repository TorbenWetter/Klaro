# Klaro

![Cursor 2-Day AI Hackathon](https://ai-beavers.com/_next/image?url=%2Fimages%2Fhackathon-hero-20012026.png&w=1920&q=75)

> AI-powered browser extension that makes the web accessible for everyone.

---

## The Problem

**1.3 billion people globally live with a disability that affects how they use the internet.** That's 16% of the world's population. Despite this, 95% of the top million websites still fail basic accessibility standards.

This isn't just a social failure — it's a massive business leak. **86% of users with disabilities leave a site immediately if it's not accessible**, representing over $13 trillion in purchasing power walking away.

## The Solution

**Klaro puts the power back in the user's hands.** Instead of waiting for websites to fix themselves, Klaro stores your individual needs in a personal profile. Whether you have low vision, dyslexia, or motor impairments, our AI automatically re-renders every site you visit in real-time.

We offer **ambient personalization** that adapts the web to you — not the other way around.

### Key Features

- **Personal Accessibility Profile** — Set your preferences once, apply everywhere
- **AI-Powered Re-rendering** — Automatically transforms any website to match your needs
- **Real-time Adaptation** — Works instantly as you browse
- **Onboarding Flow** — Simple setup for font size, spacing, and contrast preferences

## Tech Stack

- **Extension Framework**: [WXT](https://wxt.dev/) (Manifest v3, HMR, side panel)
- **Frontend**: [Svelte 5](https://svelte.dev/) + [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [shadcn-svelte](https://shadcn-svelte.com/) + [Bits UI](https://bits-ui.com/)
- **AI/ML**: [Google Gemini API](https://ai.google.dev/gemini-api/docs)
- **Content Extraction**: [@mozilla/readability](https://github.com/mozilla/readability)

## How to Run

```bash
# Clone the repo
git clone https://github.com/TorbenWetter/Klaro.git
cd Klaro

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Add your Gemini API key to .env (get one at https://aistudio.google.com/app/apikey)

# Run the development server
pnpm dev
```

Load the extension from `.output/chrome-mv3-dev` in Chrome's extension page (`chrome://extensions` with Developer mode enabled).

## Business Model

**Freemium approach:**

| Tier        | Price    | Features                                                           |
| ----------- | -------- | ------------------------------------------------------------------ |
| **Free**    | $0       | 100 screen-readings per week                                       |
| **Premium** | $4.99/mo | Unlimited use, ad-blocker, AI-translation to easy-to-read language |

## Go-To-Market Strategy

We're taking a **human-first** approach:

1. **Power of 10** — Friends and family validation
2. **Power of 100** — Meeting elderly and disabled communities where they are
3. **Scale** — Targeted Google Ads for global reach

## Team

We are a diverse team of strategists and engineers with over 30 years of combined experience in product development.

**Ben, Dennis, Max, Torben**

## Why We Built This

The digital world was built for the young and fit, leaving the elderly and disabled behind. At Klaro, we believe it's time to change that.

**We're making the web _klar_ for everyone.**

---

_Built at the [Cursor 2-Day AI Hackathon](https://ai-beavers.com) in Hamburg (31.1 – 1.2.2025)_
