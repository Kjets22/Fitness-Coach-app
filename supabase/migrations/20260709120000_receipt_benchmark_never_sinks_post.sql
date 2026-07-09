-- ============================================================
-- OptimalFit Phase 3 — fix: a benchmark-side constraint must
-- NEVER cost the user their verified post.
--
-- Bug (migration 06, create_receipt_post): on a VERIFIED pr/
-- consistency receipt the function inserts an anonymized row into
-- benchmark_contributions in the SAME transaction as the post.
-- The plausibility gates cap only the *upward* per-step e1RM jump
-- (<= +10%/week); *downward* movement is uncapped. So a fully
-- plausibility-VALID pr series that declines steeply (e.g. e1RM
-- 500 -> 20 over ~3 weeks, every step within [20,500] and never
-- rising) yields an overall weekly_progress_pct below -50, which
-- trips CHECK benchmark_contributions_weekly_progress_pct_check
-- (between -50 and 50). That 23514 aborts the whole RPC
-- transaction: the post AND its verified checkmark are rolled back
-- and lost, even though the receipt itself passed every gate.
-- (Mild flat/slow declines in [-50,0] were always fine — they sit
-- inside the CHECK range — so this only bites the pathological tail,
-- but when it bites, the user silently loses their post.)
--
-- Fix (surgical, behavior-preserving): wrap ONLY the benchmark
-- contribution in its own BEGIN/EXCEPTION sub-block. In PL/pgSQL an
-- EXCEPTION clause opens an internal savepoint, so if the
-- contribution insert/upsert raises (this CHECK, or ANY future
-- benchmark-side constraint), we roll back JUST that statement and
-- swallow the error. The post was already inserted in the outer
-- block and is untouched; the function returns normally and the
-- transaction commits the verified post. The only consequence of a
-- rejected contribution is one omitted cohort data point — which for
-- a declining "PR" is the right thing to drop anyway. Every normal
-- in-range receipt still contributes exactly as before.
--
-- Nothing else about create_receipt_post changes: same signature,
-- same structural/plausibility gates, same return shape, same grants.
-- ============================================================
create or replace function public.create_receipt_post(
  p_kind    text,
  p_caption text,
  p_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid         uuid := auth.uid();
  v_type        text;
  v_age         text;
  v_lift        text := null;
  v_reason      text := null;
  v_weekly_pct  numeric := null;
  v_consistency numeric := null;
  v_post_id     uuid;
  -- pr series walk
  v_series    jsonb;
  v_n         integer;
  v_elem      jsonb;
  v_prev_day  date;
  v_prev_val  numeric;
  v_cur_day   date;
  v_cur_val   numeric;
  v_first_day date;
  v_first_val numeric;
  v_span      integer;
  -- consistency walk
  v_planned      integer;
  v_done         integer;
  v_sum_planned  integer := 0;
  v_sum_done     integer := 0;
  -- progress / weekly scalars
  v_start numeric;
  v_end   numeric;
  v_days  integer;
  v_num   numeric;
begin
  -- ---- structural gates: hard errors -----------------------
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_kind is distinct from 'receipt' then
    raise exception 'create_receipt_post only accepts kind=''receipt''';
  end if;
  if p_caption is not null and char_length(p_caption) > 1000 then
    raise exception 'caption exceeds 1000 characters';
  end if;
  if p_receipt is null or jsonb_typeof(p_receipt) <> 'object' then
    raise exception 'receipt payload must be a JSON object';
  end if;
  if pg_column_size(p_receipt) > 16384 then
    raise exception 'receipt payload too large';
  end if;
  v_type := p_receipt->>'type';
  if v_type is null or v_type not in ('pr', 'consistency', 'progress', 'weekly') then
    raise exception 'receipt.type must be one of pr|consistency|progress|weekly';
  end if;
  v_age := coalesce(p_receipt->>'training_age', 'unknown');
  if v_age not in ('lt1y', '1to3y', 'gt3y', 'unknown') then
    v_age := 'unknown';
  end if;

  -- ---- plausibility gates: soft failures set v_reason -------
  begin
    if v_type = 'pr' then
      v_lift := left(btrim(coalesce(p_receipt->>'lift', '')), 50);
      v_series := p_receipt->'series';
      if v_lift = '' then
        v_reason := 'pr receipt missing lift name';
      elsif v_series is null or jsonb_typeof(v_series) <> 'array' then
        v_reason := 'pr receipt missing e1RM series';
      else
        v_n := jsonb_array_length(v_series);
        if v_n < 6 then
          v_reason := 'need at least 6 e1RM data points as backing history';
        else
          for i in 0 .. v_n - 1 loop
            v_elem := v_series->i;
            v_cur_day := (v_elem->>'day')::date;
            v_cur_val := (v_elem->>'e1rm')::numeric;
            if v_cur_day is null or v_cur_val is null then
              v_reason := 'series points must carry day and e1rm';
              exit;
            end if;
            if v_cur_val < 20 or v_cur_val > 500 then
              v_reason := 'e1RM outside plausible 20-500 kg range';
              exit;
            end if;
            if v_prev_day is not null then
              if v_cur_day <= v_prev_day then
                v_reason := 'series dates must be strictly increasing';
                exit;
              end if;
              -- compounded weekly growth cap: <= +10%/week
              if v_cur_val > v_prev_val
                   * power(1.10, (v_cur_day - v_prev_day)::numeric / 7.0)
                   + 0.001 then
                v_reason := 'e1RM jump exceeds +10% per week — implausible';
                exit;
              end if;
            else
              v_first_day := v_cur_day;
              v_first_val := v_cur_val;
            end if;
            v_prev_day := v_cur_day;
            v_prev_val := v_cur_val;
          end loop;
          if v_reason is null then
            v_span := v_prev_day - v_first_day;
            if v_span < 21 then
              v_reason := 'series must span at least 21 days';
            else
              -- overall weekly progression %, for the benchmark pool
              v_weekly_pct := round(
                (power(v_prev_val / v_first_val, 7.0 / v_span) - 1) * 100, 3);
            end if;
          end if;
        end if;
      end if;

    elsif v_type = 'consistency' then
      v_series := p_receipt->'weeks';
      if v_series is null or jsonb_typeof(v_series) <> 'array'
         or jsonb_array_length(v_series) < 2 then
        v_reason := 'consistency receipt needs a weeks array (>=2 weeks)';
      else
        for i in 0 .. jsonb_array_length(v_series) - 1 loop
          v_planned := (v_series->i->>'planned')::integer;
          v_done := (v_series->i->>'done')::integer;
          if v_planned is null or v_done is null
             or v_planned < 1 or v_planned > 7
             or v_done < 0 or v_done > 7 then
            v_reason := 'weeks must carry planned 1-7 and done 0-7';
            exit;
          end if;
          v_sum_planned := v_sum_planned + v_planned;
          v_sum_done := v_sum_done + least(v_done, v_planned);
        end loop;
        if v_reason is null then
          v_consistency := round(v_sum_done::numeric / v_sum_planned, 4);
        end if;
      end if;

    elsif v_type = 'progress' then
      v_start := (p_receipt->>'start_value')::numeric;
      v_end   := (p_receipt->>'end_value')::numeric;
      v_days  := (p_receipt->>'days')::integer;
      if v_start is null or v_end is null or v_days is null then
        v_reason := 'progress receipt needs start_value, end_value, days';
      elsif v_start < 30 or v_start > 300 or v_end < 30 or v_end > 300 then
        v_reason := 'progress values outside plausible 30-300 range';
      elsif v_days < 14 or v_days > 730 then
        v_reason := 'progress window must be 14-730 days';
      elsif abs(power(v_end / v_start, 7.0 / v_days) - 1) > 0.015 then
        v_reason := 'body-metric change exceeds 1.5% per week — implausible';
      end if;

    elsif v_type = 'weekly' then
      v_num := (p_receipt->>'workouts')::numeric;
      if v_num is null or v_num < 0 or v_num > 7 or v_num <> floor(v_num) then
        v_reason := 'weekly receipt needs workouts as an integer 0-7';
      end if;
      if v_reason is null and p_receipt ? 'total_sets' then
        v_num := (p_receipt->>'total_sets')::numeric;
        if v_num is null or v_num < 0 or v_num > 250 then
          v_reason := 'total_sets outside plausible 0-250 range';
        end if;
      end if;
      if v_reason is null and p_receipt ? 'total_volume_kg' then
        v_num := (p_receipt->>'total_volume_kg')::numeric;
        if v_num is null or v_num < 0 or v_num > 150000 then
          v_reason := 'total_volume_kg outside plausible range';
        end if;
      end if;
    end if;
  exception when others then
    -- malformed numbers/dates inside the payload → soft failure
    v_reason := 'receipt payload is malformed: ' || sqlerrm;
  end;

  -- ---- insert the post (definer bypasses posts RLS) ---------
  insert into public.posts (author_id, kind, caption, receipt, verified)
  values (v_uid, 'receipt', p_caption, p_receipt, v_reason is null)
  returning id into v_post_id;

  -- ---- verified → contribute an anonymized benchmark row -----
  -- The contribution is best-effort and MUST NOT be able to undo the
  -- post above. Its own BEGIN/EXCEPTION sub-block savepoints the
  -- upsert: if a benchmark-side constraint rejects it (e.g. an
  -- out-of-range weekly_progress_pct from a steep-decline series, or
  -- any future constraint), we roll back only this statement and keep
  -- the verified post. A rejected contribution just omits one cohort
  -- data point; the checkmark is never collateral damage.
  if v_reason is null and v_type in ('pr', 'consistency') then
    begin
      insert into public.benchmark_contributions
        (user_id, receipt_type, lift, training_age_bucket,
         weekly_progress_pct, consistency_ratio)
      values
        (v_uid, v_type, v_lift, v_age, v_weekly_pct, v_consistency)
      on conflict (user_id, receipt_type, lift_key) do update
        set weekly_progress_pct = excluded.weekly_progress_pct,
            consistency_ratio   = excluded.consistency_ratio,
            training_age_bucket = excluded.training_age_bucket,
            updated_at          = now();
    exception when others then
      -- swallow: post already committed in the outer block; skip the
      -- anonymized contribution rather than sink the user's receipt.
      null;
    end;
  end if;

  return jsonb_build_object(
    'post_id', v_post_id,
    'verified', v_reason is null,
    'reason', v_reason
  );
end;
$$;

revoke execute on function public.create_receipt_post(text, text, jsonb) from public, anon;
grant execute on function public.create_receipt_post(text, text, jsonb) to authenticated, service_role;
