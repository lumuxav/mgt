# Universal MGT Backend Binding

Universal MGT uses a dedicated Supabase project and dedicated Vercel deployment.

## Required environment variables

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Optional production services add their own server-only credentials.

## Isolation guard

Server code validates that `NEXT_PUBLIC_SUPABASE_URL` points to the expected Universal MGT Supabase project before privileged service-role operations are allowed.

## Deployment

The active application is deployed from:

```text
repository: lumuxav/mgt
branch: universal-business-platform
```

The application homepage is configured on the GitHub repository and Vercel project.

## Rules

- never commit Supabase or provider secret keys
- keep the service-role key server-side
- use the Universal MGT project for all application migrations
- use versioned migrations for schema changes
- keep production provider credentials in server-side/Vault storage
