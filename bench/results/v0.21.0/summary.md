# Boring CMS benchmark v0.21.0

Run: 2026-09-20T19:10:58.646Z on Linux 7.1.10-200.fc44.x86_64, AMD Ryzen 5 5600X 6-Core Processor (12 cores host).
Constraints and methodology: see bench/README.md. Read it before comparing numbers; the CPU pinning, memory caps, rate limit override, and client placement all shape these results.

## Throughput (ops/s) by phase

| Phase | node-1cpu |
| --- | ---: |
| schema_apply | 707.5 |
| schema_read | 2149.9 |
| create_short | 1333.1 |
| create_long | 875.5 |
| create_short_restcall | 1876.2 |
| batch_create_short_x200 | 116 |
| read_list_short | 3647.5 |
| read_list_long | 2313.2 |
| read_single_short | 3799.6 |
| read_single_long | 2699.7 |
| read_304_etag | 4250.6 |
| update_then_read | 1076.3 |
| rewrite_dry_1pair | 202.6 |
| rewrite_dry_200pairs | 148.6 |
| rewrite_live_200pairs | 96.2 |
| media_upload_64kb | 795.2 |
| media_serve_64kb | 1393.2 |
| media_reupload | 677.9 |
| media_delete | 2371.4 |
| link_access | 3642.3 |
| read_concurrent_20 | 6304.6 |
| write_concurrent_10 | 3261.5 |
| schedule_future | 989.6 |
| read_list_short_with_scheduled | 2612.5 |
| read_single_scheduled_404 | 4893.8 |
| list_scheduled | 1429.9 |
| get_entry_draft_scheduled | 2359.5 |
| reschedule_entry | 2175.2 |
| scheduled_goes_live | 0.3 |
| misc_seed | 1338.1 |
| misc_read_only | 5606.6 |
| misc_read_write | 5212.2 |
| misc_write_votes | 8914.1 |
| misc_write_edits | 2068.3 |
| misc_hot_votes | 8227.3 |
| misc_hot_mixed | 10467.1 |
| misc_hot_repeat_voters | 9592.1 |
| misc_private_bump | 6824.1 |
| openapi_read | 5887 |
| auth_gate_probes | 3736.9 |
| rate_limit_on | 2242.5 |
| delete_entries | 2577.1 |

## Latency p50 / p95 (ms) by phase

| Phase | node-1cpu |
| --- | ---: |
| schema_apply | 1.34 / 2.42 |
| schema_read | 0.41 / 0.84 |
| create_short | 0.66 / 1.08 |
| create_long | 1.03 / 1.84 |
| create_short_restcall | 0.47 / 0.76 |
| batch_create_short_x200 | 8.6 / 8.68 |
| read_list_short | 0.25 / 0.39 |
| read_list_long | 0.32 / 0.64 |
| read_single_short | 0.23 / 0.34 |
| read_single_long | 0.35 / 0.47 |
| read_304_etag | 0.21 / 0.31 |
| update_then_read | 0.83 / 1.4 |
| rewrite_dry_1pair | 4.93 / 4.93 |
| rewrite_dry_200pairs | 6.73 / 6.73 |
| rewrite_live_200pairs | 10.39 / 10.39 |
| media_upload_64kb | 0.84 / 2 |
| media_serve_64kb | 0.54 / 0.94 |
| media_reupload | 0.85 / 2.48 |
| media_delete | 0.36 / 0.64 |
| link_access | 0.23 / 0.53 |
| read_concurrent_20 | 2.27 / 5.29 |
| write_concurrent_10 | 2.24 / 5.16 |
| schedule_future | 0.85 / 1.27 |
| read_list_short_with_scheduled | 0.36 / 0.48 |
| read_single_scheduled_404 | 0.2 / 0.25 |
| list_scheduled | 0.68 / 0.84 |
| get_entry_draft_scheduled | 0.4 / 0.5 |
| reschedule_entry | 0.45 / 0.5 |
| scheduled_goes_live | 3105.74 / 3105.74 |
| misc_seed | 0.66 / 1.14 |
| misc_read_only | 2.53 / 5.1 |
| misc_read_write | 2.56 / 5.47 |
| misc_write_votes | 3.06 / 6.19 |
| misc_write_edits | 1.41 / 4.95 |
| misc_hot_votes | 6.17 / 16.09 |
| misc_hot_mixed | 5.32 / 11.64 |
| misc_hot_repeat_voters | 5.62 / 14.81 |
| misc_private_bump | 2.33 / 4.87 |
| openapi_read | 1.14 / 2.29 |
| auth_gate_probes | 1.84 / 2.76 |
| rate_limit_on | 0.27 / 0.6 |
| delete_entries | 0.37 / 0.45 |

## Run metadata

| Run | Runtime | vCPUs | Peak RSS (MB) | Wall (s) |
| --- | --- | ---: | ---: | ---: |
| node-1cpu | v24.13.1 | 1 | 127 | 8 |
