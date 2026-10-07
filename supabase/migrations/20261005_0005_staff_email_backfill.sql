-- MGT Business Suite — Backfill staff identity data and prevent duplicate active emails

update public.users u
set email = au.email,
    updated_at = now()
from auth.users au
where au.id = u.id
  and (u.email is null or trim(u.email) = '');

drop index if exists users_org_email_unique;
create unique index users_org_email_unique
  on public.users(organization_id, lower(email))
  where email is not null and archived_at is null;
