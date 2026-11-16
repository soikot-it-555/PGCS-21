-- =====================================================================
-- PGCS-21 — Migration v4 (integrity guards for payments)
-- Run AFTER supabase-migration-v3.sql. Idempotent. Changes / deletes NO existing row.
--   * an Approved payment can only change to Voided (with a reason); amount / member / installment / date are frozen
--   * a Voided payment is a read-only audit record and can never be hard-deleted
-- (Approved-delete protection already exists from v3.)
-- NOTE: the app still uses its own MID/password login, so the database cannot tell Admin (IT) from a Member;
-- "only Admin (IT) may void" is enforced by the application. These rules protect DATA INTEGRITY for every client.
-- =====================================================================
create or replace function pgcs_payment_guard() returns trigger language plpgsql as $$
declare strip text[] := array['status','previousStatus','voidedAt','voidedBy','voidReason'];
begin
  if old.data->>'status' = 'Voided' then
    if new.data is distinct from old.data then raise exception 'A Voided payment is a read-only audit record'; end if;
    return new;
  end if;
  if old.data->>'status' = 'Approved' then
    if new.data->>'status' = 'Approved' then
      if (new.data - strip) is distinct from (old.data - strip) then raise exception 'An Approved payment cannot be edited - void it instead'; end if;
    elsif new.data->>'status' = 'Voided' then
      if (new.data - strip) is distinct from (old.data - strip) then raise exception 'Only the status may change when voiding a payment'; end if;
      if coalesce(btrim(new.data->>'voidReason'), '') = '' then raise exception 'A reason is required to void an approved payment'; end if;
    else
      raise exception 'An Approved payment can only be voided';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists payments_guard on payments;
create trigger payments_guard before update on payments for each row execute function pgcs_payment_guard();

create or replace function pgcs_protect_approved_payment_delete() returns trigger language plpgsql as $$
begin
  if coalesce(old.data->>'status','') in ('Approved','Voided') then
    raise exception 'Approved/Voided payments must be voided, not physically deleted';
  end if;
  return old;
end $$;
