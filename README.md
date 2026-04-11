This is the first working skeleton for `RIA File Ops`, a product concept for
organizing advisory-firm document intake.

## What it includes

- marketing homepage
- protected dashboard
- Google sign-in
- separate Google Drive permission step
- live Drive metadata preview after connection
- saved firm settings in a local SQLite database

## Before you run it

Create a `.env.local` file in the project root and add:

```bash
NEXTAUTH_SECRET=replace-this-with-a-long-random-string
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
```

You will also need a Google OAuth app configured with this redirect URI:

```text
http://localhost:3000/api/auth/callback/google
```

For production later, add your real app domain as another redirect URI.

## Getting started

Install dependencies and run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Current user flow

1. Visit `/login`
2. Sign in with Google
3. Open `Settings`, then go to `Storage connections`
4. Grant Google Drive metadata access
5. Stay in `Settings`
6. Save firm name, source folder, destination root, naming convention, and folder template
7. Visit `/dashboard`

## What comes next

- hook in the document processing pipeline
- add a review queue for uncertain matches
- add a real folder picker instead of a simple dropdown list
- connect saved settings to the document renaming and filing engine

## Notes

This prototype currently requests the Google Drive metadata read-only scope:

```text
https://www.googleapis.com/auth/drive.metadata.readonly
```

That is enough to prove the integration works and preview files. We can expand
or refine scopes later when we build real folder selection, rename, move, and
processing actions.

Firm settings are currently stored in a local SQLite file at `data/ria-file-ops.db`.
That is good for development on your machine. For production later, we would move
this to a hosted database.
