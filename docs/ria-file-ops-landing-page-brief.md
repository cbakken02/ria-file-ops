# RIA File Ops Landing Page Brief

## 1. Product wedge

RIA File Ops is an automated file intake and filing-prep tool for RIA operations teams. It watches client upload folders, identifies uploaded documents, applies the firm's naming convention, suggests the correct destination folder, and lets the team confirm or edit before moving and renaming files.

## 2. Current product focus

The current concrete value is filing prep for client uploads:

- A client uploads documents.
- RIA File Ops detects the new files.
- It scans and reads the documents.
- It identifies document type and useful filing details.
- It prepares the suggested filename.
- It prepares the suggested destination folder.
- The user confirms or edits.
- The file is renamed and moved.

## 3. Customer pain

New-client onboarding and client uploads create a filing job. Every document has to be opened, identified, renamed, and moved. Client service specialists already try to do this manually, but it takes time and naming conventions drift.

## 4. Objection to address

The visitor may think: "Why not just have the client service specialist rename the files?"

The answer: that is the work. Manual renaming still requires opening every file, identifying what it is, extracting account, client, and date details, remembering the naming convention, finding the folder, moving the file, and doing it consistently across the team.

## 5. Preferred language

Use:

- Automated file intake for RIAs
- Automated filing for RIA client uploads
- File client uploads without the manual cleanup.
- Turn new-client uploads into clean, convention-ready folders.
- File onboarding documents without opening, naming, and moving every upload by hand.
- Your team confirms the final move.
- Clean filing is the first layer.

Avoid:

- approval queue
- document intelligence as the main hero
- workflow-ready outputs
- AI-powered everything
- Client uploads in. Clean folders out.
- Try Filing Demo as a major CTA
- huge busy hero demo
- scrollbars inside the hero product mockup
- layout shift when demo state changes
- fake security/compliance claims
- fake testimonials/logos/metrics
- saying files move with no human control

## 6. Suggested hero copy

Preferred eyebrow:

Automated filing for RIA client uploads

Preferred headline:

File client uploads without the manual cleanup.

Recommended support line:

RIA File Ops detects new uploads, identifies each document, applies your firm's naming rules, and prepares the destination so your team can approve and file faster.

Primary CTA:

Join Waitlist

Optional secondary link:

See how it works

Header:

RIA File Ops, Product, Workflow, Coming Next. Logged-out users should see Join Waitlist as the top-right action. If the user is authenticated and existing auth behavior makes it easy, show Go to App for authenticated users.

## 7. Main visual direction

The hero should show a simple static product preview, not the full interactive filing demo. The hero's job is product comprehension and conversion.

The static hero preview should communicate:

Client upload folder -> RIA File Ops detects/prepares -> clean client folder

It should not show every detail at once. Avoid internal scrollbars, reset controls, editable fields, instructions modals, file-selection state, or layout that changes based on selected file.

Hero preview concept:

Left: Client Uploads

- Show a small set of messy uploads, not a full selectable list.
- Example: statement.pdf, IMG_4821.pdf, tax-return-upload.pdf
- Badge like "New upload detected" or "Onboarding batch"

Center: RIA File Ops Filing Prep / Detects and prepares

- Detected: Schwab IRA Statement
- Client: Jane Miller
- Custodian: Schwab
- Suggested filename: Miller_Jane - Schwab IRA 1234 - 2026-04 Statement.pdf
- Suggested destination: Clients / Jane Miller / Investments / Statements / Schwab
- Keep this preview compact; do not include full controls in the hero.

Right: Clean Client Folder

- Clients
- -> Jane Miller
- -> Investments
- -> Statements
- -> Schwab
- -> Miller_Jane - Schwab IRA 1234 - 2026-04 Statement.pdf

## 8. Required landing page sections

- Hero with simple static product preview
- Dedicated guided demo section
- Manual cleanup objection section
- Onboarding batch / dozens of filing decisions section
- Workflow section: Detect, Identify, Suggest, Confirm, File
- Future layer section: Missing Document View, Folder Readiness, Task Prep
- Final CTA

Final CTA should use one primary Join Waitlist button.

## 9. Manual cleanup section copy

Headline:

Renaming every client upload takes time — and still drifts.

Body direction:

Every upload still has to be opened, identified, renamed, and moved. Done by hand, small variations creep in: dates get formatted differently, client names vary, account details get missed, and folders become harder to trust.

Comparison:

Manual filing:

Open file -> identify document -> check naming rule -> extract details -> rename -> find folder -> move -> repeat

RIA File Ops:

Detect upload -> identify document -> suggest name -> suggest folder -> confirm -> file cleanly

## 9a. Guided demo section

The full demo should live in a dedicated guided demo section, not inside the hero. The section can appear directly after the hero or after the first problem/manual-cleanup section, depending on page rhythm.

Section headline:

See how one upload gets filed.

Support:

Walk through how RIA File Ops detects a messy upload, prepares the filing details, and lets your team approve the final move.

The guided demo should show one step at a time with a progress indicator. It is a simulated front-end landing page walkthrough only. Do not allow real public file uploads. Do not connect this demo to real file processing or create backend routes for it.

Guided demo steps:

1. Client uploads
   - Show a generic client upload folder.
   - Show a pulsing file card named statement.pdf.
   - Primary action: Upload sample file.
   - Copy: A client uploads a document with a generic name.

2. Detect
   - Show the file landing in the client upload folder.
   - Show RIA File Ops detecting it.
   - Status: New upload detected.
   - Primary action: Identify document.

3. Identify
   - Show detected fields:
     - Detected: Schwab IRA Statement
     - Client: Jane Miller
     - Custodian: Schwab
     - Account type: IRA
     - Account ending: 1234
     - Period: April 2026
   - Primary action: Review filing details.

4. Review
   - Show a review modal/screen similar to the actual app's review modal where possible.
   - Left side: fake PDF/document preview with highlighted values.
   - Right side: detected fields, suggested filename, and suggested destination.
   - Suggested filename: Miller_Jane - Schwab IRA 1234 - 2026-04 Statement.pdf
   - Suggested destination: Clients / Jane Miller / Investments / Statements / Schwab
   - Actions: Approve & File, Edit Details.

5. Filed
   - Show the clean client folder.
   - Show the renamed file in the right destination.
   - Status: Filed cleanly.
   - Primary action: Replay demo.

Interaction rules:

- One primary action per step.
- Use simple React state.
- Keep dimensions stable to avoid layout shift.
- Use keyboard-accessible buttons and clear focus states.
- Use subtle animation only to guide attention: pulsing file, scan line, progress highlight, or file moving into folder.
- Mobile should stack cleanly.
- Do not use "Try Filing Demo" as a major hero CTA.

## 10. Batch section copy

Headline:

One onboarding can create dozens of filing decisions.

Body direction:

Each file needs answers:

- What is this document?
- Who is it for?
- Which account or custodian is tied to it?
- What should it be called?
- Where should it go?

Example estimate card:

30 documents x 2-4 minutes per file = 1-2 hours of manual filing work

Important: present this as an example scenario, not an industry statistic.

## 11. UI direction

The page should be modern, sharp, product-specific, and visually interesting. It should not be boring, generic, or text-heavy.

Use the existing site's fonts, colors, spacing, border radius, and component style where appropriate, but make the landing page pop more than the current version.

Possible UI elements:

- Animated file-flow lines
- Subtle border highlight around active filing-prep card
- Bento-style problem cards
- Compact estimate card
- Before/after file naming comparison
- Realistic review/prep screen
- Static hero product preview with no internal scrollbars
- Dedicated guided demo with stable dimensions and one state visible at a time

Do not blindly paste in a full external template or add large dependencies unless clearly justified.

## 12. Implementation constraints

- Do not fully scrap the current landing page.
- Keep the current dark premium visual direction and useful UI pieces.
- Reuse only helpful auth/routing/style patterns.
- Remove the complex interactive demo from the hero and replace it with a static preview.
- Put the full walkthrough in a dedicated guided demo section.
- Do not touch unrelated parser logic, API routes, Supabase config, database migrations, environment files, or auth internals.
- Keep the page responsive.
- Desktop should have a strong product mockup.
- Mobile should be stacked and readable.
- Run available lint/build/type checks after implementation.

Final CTA copy:

Eyebrow:

Ready to clean up uploads?

Headline:

Stop filing client uploads by hand.

Support:

Join the waitlist for automated filing built around RIA naming rules and folder structures.

Button:

Join Waitlist
