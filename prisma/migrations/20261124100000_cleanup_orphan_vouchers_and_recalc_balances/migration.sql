-- Cleanup orphan vouchers whose parent documents were deleted in the past
DELETE FROM payment_allocations
WHERE (invoice_id IS NOT NULL AND invoice_id NOT IN (SELECT id FROM sales_invoices))
   OR (purchase_invoice_id IS NOT NULL AND purchase_invoice_id NOT IN (SELECT id FROM purchase_invoices))
   OR voucher_id IN (
     SELECT v.id FROM vouchers v
     WHERE (
       (v.source_document = 'SALES_INVOICE' AND v.source_entity_id IS NOT NULL AND v.source_entity_id NOT IN (SELECT id FROM sales_invoices))
       OR (v.source_document = 'PURCHASE_INVOICE' AND v.source_entity_id IS NOT NULL AND v.source_entity_id NOT IN (SELECT id FROM purchase_invoices))
       OR (v.source_document = 'SALES_RETURN' AND v.source_entity_id IS NOT NULL AND v.source_entity_id NOT IN (SELECT id FROM sales_returns))
       OR (v.source_document = 'PURCHASE_RETURN' AND v.source_entity_id IS NOT NULL AND v.source_entity_id NOT IN (SELECT id FROM purchase_returns))
     )
   );

DELETE FROM journal_entries
WHERE voucher_id IN (
  SELECT v.id FROM vouchers v
  WHERE (
    (v.source_document = 'SALES_INVOICE' AND v.source_entity_id IS NOT NULL AND v.source_entity_id NOT IN (SELECT id FROM sales_invoices))
    OR (v.source_document = 'PURCHASE_INVOICE' AND v.source_entity_id IS NOT NULL AND v.source_entity_id NOT IN (SELECT id FROM purchase_invoices))
    OR (v.source_document = 'SALES_RETURN' AND v.source_entity_id IS NOT NULL AND v.source_entity_id NOT IN (SELECT id FROM sales_returns))
    OR (v.source_document = 'PURCHASE_RETURN' AND v.source_entity_id IS NOT NULL AND v.source_entity_id NOT IN (SELECT id FROM purchase_returns))
  )
);

DELETE FROM vouchers
WHERE (
  (source_document = 'SALES_INVOICE' AND source_entity_id IS NOT NULL AND source_entity_id NOT IN (SELECT id FROM sales_invoices))
  OR (source_document = 'PURCHASE_INVOICE' AND source_entity_id IS NOT NULL AND source_entity_id NOT IN (SELECT id FROM purchase_invoices))
  OR (source_document = 'SALES_RETURN' AND source_entity_id IS NOT NULL AND source_entity_id NOT IN (SELECT id FROM sales_returns))
  OR (source_document = 'PURCHASE_RETURN' AND source_entity_id IS NOT NULL AND source_entity_id NOT IN (SELECT id FROM purchase_returns))
);

-- Recalculate ledger account balances from active non-cancelled journal entries
WITH balances AS (
  SELECT
    la.id AS account_id,
    CASE
      WHEN lg.nature IN ('ASSET', 'EXPENSE') THEN
        (CASE WHEN la.opening_type = 'DR' THEN la.opening_balance ELSE -la.opening_balance END)
        + COALESCE(SUM(je.debit_amount), 0) - COALESCE(SUM(je.credit_amount), 0)
      ELSE
        (CASE WHEN la.opening_type = 'CR' THEN la.opening_balance ELSE -la.opening_balance END)
        + COALESCE(SUM(je.credit_amount), 0) - COALESCE(SUM(je.debit_amount), 0)
    END AS new_balance
  FROM ledger_accounts la
  JOIN ledger_groups lg ON lg.id = la.group_id
  LEFT JOIN (
    journal_entries je
    JOIN vouchers v ON v.id = je.voucher_id AND v.is_cancelled = false
  ) ON je.account_id = la.id
  GROUP BY la.id, la.opening_type, la.opening_balance, lg.nature
)
UPDATE ledger_accounts
SET current_balance = balances.new_balance
FROM balances
WHERE ledger_accounts.id = balances.account_id;
