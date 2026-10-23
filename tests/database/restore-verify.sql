begin;
select set_config('request.jwt.claims','{"sub":"dddddddd-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
do $$ declare j uuid; r jsonb; statement jsonb; begin
 select id into strict j from public.work_orders where title='Restored cancellation';
 r:=public.cancel_service_work_order('dddddddd-0000-4000-8000-000000000007',j,'Restore fixture return',10,'bank','dddddddd-0000-4000-8000-000000000006','RESTORE-REFUND',true);
 if (r->>'refunded_amount')::numeric<>10 then raise exception 'Refund retry did not survive restore'; end if;
 if (select count(*) from public.payments where work_order_id=j and direction='out')<>1 then raise exception 'Refund duplicated during restore'; end if;
 if (select quantity from public.stock_balances where product_id='dddddddd-0000-4000-8000-000000000004')<>10 then raise exception 'Stock changed during restore'; end if;
 if (select balance from public.get_bank_account_summaries() where id='dddddddd-0000-4000-8000-000000000006')<>90 then raise exception 'Bank balance changed during restore'; end if;
 statement:=public.get_party_statement('customer','dddddddd-0000-4000-8000-000000000005',current_date-1,current_date+1);
 if (statement->>'closing')::numeric<>0 then raise exception 'Cancelled-job statement changed during restore'; end if;
 if exists(select 1 from public.accounting_journal_lines group by journal_id having abs(sum(debit-credit))>0.009) then raise exception 'Unbalanced restored journal'; end if;
 if has_table_privilege('authenticated','public.service_cancellation_requests','INSERT') then raise exception 'Restore weakened ledger access'; end if;
end $$;
rollback;
