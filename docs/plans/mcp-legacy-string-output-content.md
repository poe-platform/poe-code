# Legacy typed scalar string content

The current-source complete stdio suite reproduced a typed scalar string handler producing quoted JSON text for legacy clients, contrary to the maintained plain-text compatibility contract. Preserve the raw handler string as legacy text while retaining modern structured output and caller-supplied result envelopes.

Run the complete current-source stdio suite after the fix. Array, number, null, and explicit envelope behavior must retain their existing contracts.
