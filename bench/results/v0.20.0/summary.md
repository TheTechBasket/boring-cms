# Boring CMS benchmark v0.20.0

Run: 2026-09-20T06:33:15.097Z on Linux 7.1.10-200.fc44.x86_64, AMD Ryzen 5 5600X 6-Core Processor (12 cores host).
Constraints and methodology: see bench/README.md. Read it before comparing numbers; the CPU pinning, memory caps, rate limit override, and client placement all shape these results.

## Throughput (ops/s) by phase

| Phase | node-1cpu |
| --- | ---: |
| schema_apply | 951.2 |
| schema_read | 2249 |
| create_short | 1848.8 |
| create_long | 1136.8 |
| create_short_restcall | 2293.2 |
| batch_create_short_x200 | 122 |
| read_list_short | 4462.1 |
| read_list_long | 3227.2 |
| read_single_short | 5200.3 |
| read_single_long | 3207 |
| read_304_etag | 5061.2 |
| update_then_read | 1204.6 |
| rewrite_dry_1pair | 43.8 |
| rewrite_dry_200pairs | 41.9 |
| rewrite_live_200pairs | 16.1 |
| media_upload_64kb | 983.1 |
| media_serve_64kb | 1788.4 |
| media_reupload | 1075.5 |
| media_delete | 2635.4 |
| link_access | 4322.2 |
| read_concurrent_20 | 7988.3 |
| write_concurrent_10 | 3405.7 |
| schedule_future | 1287.1 |
| read_list_short_with_scheduled | 2932.1 |
| read_single_scheduled_404 | 5483.8 |
| list_scheduled | 1563.1 |
| get_entry_draft_scheduled | 2900.8 |
| reschedule_entry | 2549.9 |
| scheduled_goes_live | 0.3 |
| misc_seed | 1591.8 |
| misc_read_only | 2679.2 |
| misc_read_write | 3201.2 |
| misc_write_votes | 9879.1 |
| misc_write_edits | 2566.6 |
| misc_hot_votes | 10353 |
| misc_hot_mixed | 11010.3 |
| misc_hot_repeat_voters | 10679.5 |
| misc_private_bump | 9025.3 |
| delete_entries | 2702.2 |

## Latency p50 / p95 (ms) by phase

| Phase | node-1cpu |
| --- | ---: |
| schema_apply | 0.83 / 1.68 |
| schema_read | 0.35 / 0.72 |
| create_short | 0.47 / 0.81 |
| create_long | 0.8 / 1.22 |
| create_short_restcall | 0.41 / 0.52 |
| batch_create_short_x200 | 7.75 / 12.66 |
| read_list_short | 0.21 / 0.27 |
| read_list_long | 0.27 / 0.38 |
| read_single_short | 0.18 / 0.22 |
| read_single_long | 0.29 / 0.37 |
| read_304_etag | 0.17 / 0.23 |
| update_then_read | 0.72 / 1.36 |
| rewrite_dry_1pair | 22.83 / 22.83 |
| rewrite_dry_200pairs | 23.89 / 23.89 |
| rewrite_live_200pairs | 62.05 / 62.05 |
| media_upload_64kb | 0.7 / 1.29 |
| media_serve_64kb | 0.37 / 0.86 |
| media_reupload | 0.65 / 1.12 |
| media_delete | 0.33 / 0.42 |
| link_access | 0.2 / 0.32 |
| read_concurrent_20 | 1.88 / 4.79 |
| write_concurrent_10 | 1.92 / 5.41 |
| schedule_future | 0.72 / 0.87 |
| read_list_short_with_scheduled | 0.31 / 0.4 |
| read_single_scheduled_404 | 0.18 / 0.21 |
| list_scheduled | 0.57 / 0.71 |
| get_entry_draft_scheduled | 0.31 / 0.38 |
| reschedule_entry | 0.36 / 0.45 |
| scheduled_goes_live | 3104.87 / 3104.87 |
| misc_seed | 0.58 / 0.75 |
| misc_read_only | 5.52 / 11.66 |
| misc_read_write | 4.59 / 9.55 |
| misc_write_votes | 2.71 / 5.64 |
| misc_write_edits | 1.11 / 2.42 |
| misc_hot_votes | 5.37 / 13.86 |
| misc_hot_mixed | 5.1 / 12.37 |
| misc_hot_repeat_voters | 5.26 / 14.56 |
| misc_private_bump | 1.37 / 2.96 |
| delete_entries | 0.33 / 0.45 |

## Run metadata

| Run | Runtime | vCPUs | Peak RSS (MB) | Wall (s) |
| --- | --- | ---: | ---: | ---: |
| node-1cpu | v24.13.1 | 1 | 188 | 24 |
