# Boring CMS benchmark v0.19.1

Run: 2026-09-20T05:41:46.505Z on Linux 7.1.10-200.fc44.x86_64, AMD Ryzen 5 5600X 6-Core Processor (12 cores host).
Constraints and methodology: see bench/README.md. Read it before comparing numbers; the CPU pinning, memory caps, rate limit override, and client placement all shape these results.

## Throughput (ops/s) by phase

| Phase | node-1cpu |
| --- | ---: |
| schema_apply | 757.1 |
| schema_read | 2279.9 |
| create_short | 1319.9 |
| create_long | 867.4 |
| create_short_restcall | 1789 |
| batch_create_short_x200 | 120.1 |
| read_list_short | 3587.5 |
| read_list_long | 2291.7 |
| read_single_short | 3915 |
| read_single_long | 2810 |
| read_304_etag | 4548.4 |
| update_then_read | 1113.6 |
| rewrite_dry_1pair | 215.1 |
| rewrite_dry_200pairs | 138.7 |
| rewrite_live_200pairs | 96 |
| media_upload_64kb | 760.5 |
| media_serve_64kb | 1443 |
| media_reupload | 773.6 |
| media_delete | 2231 |
| link_access | 3795.8 |
| read_concurrent_20 | 6160 |
| write_concurrent_10 | 3141.1 |
| schedule_future | 972.2 |
| read_list_short_with_scheduled | 2627.3 |
| read_single_scheduled_404 | 4813.5 |
| list_scheduled | 1442 |
| get_entry_draft_scheduled | 2357.1 |
| reschedule_entry | 2327.8 |
| scheduled_goes_live | 0.3 |
| delete_entries | 2196 |

## Latency p50 / p95 (ms) by phase

| Phase | node-1cpu |
| --- | ---: |
| schema_apply | 1.16 / 2.53 |
| schema_read | 0.38 / 0.78 |
| create_short | 0.67 / 1.12 |
| create_long | 1.06 / 1.84 |
| create_short_restcall | 0.5 / 0.86 |
| batch_create_short_x200 | 8.43 / 8.44 |
| read_list_short | 0.25 / 0.4 |
| read_list_long | 0.35 / 0.53 |
| read_single_short | 0.22 / 0.33 |
| read_single_long | 0.34 / 0.44 |
| read_304_etag | 0.19 / 0.25 |
| update_then_read | 0.82 / 1.22 |
| rewrite_dry_1pair | 4.65 / 4.65 |
| rewrite_dry_200pairs | 7.21 / 7.21 |
| rewrite_live_200pairs | 10.41 / 10.41 |
| media_upload_64kb | 0.85 / 3.46 |
| media_serve_64kb | 0.48 / 0.88 |
| media_reupload | 0.73 / 1.3 |
| media_delete | 0.36 / 0.74 |
| link_access | 0.23 / 0.32 |
| read_concurrent_20 | 2.37 / 5.58 |
| write_concurrent_10 | 2.28 / 6.44 |
| schedule_future | 0.85 / 1.88 |
| read_list_short_with_scheduled | 0.35 / 0.45 |
| read_single_scheduled_404 | 0.2 / 0.26 |
| list_scheduled | 0.69 / 0.85 |
| get_entry_draft_scheduled | 0.41 / 0.49 |
| reschedule_entry | 0.41 / 0.54 |
| scheduled_goes_live | 3105.66 / 3105.66 |
| delete_entries | 0.4 / 0.61 |

## Run metadata

| Run | Runtime | vCPUs | Peak RSS (MB) | Wall (s) |
| --- | --- | ---: | ---: | ---: |
| node-1cpu | v24.13.1 | 1 | 119 | 5 |
