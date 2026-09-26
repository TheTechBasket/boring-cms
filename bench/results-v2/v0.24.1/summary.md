# Boring CMS benchmark v0.24.1

Run: 2026-09-26T07:09:41.630Z on Linux 7.1.10-200.fc44.x86_64, AMD Ryzen 5 5600X 6-Core Processor (12 cores host).
Constraints and methodology: see bench/README.md. Read it before comparing numbers; the CPU pinning, memory caps, rate limit override, and client placement all shape these results.

## Throughput (ops/s) by phase

| Phase | node-2cpu |
| --- | ---: |
| schema_apply | 703.2 |
| field_text_write | 1424.1 |
| field_text_read | 7972.4 |
| field_markdown_write | 1827.9 |
| field_markdown_read | 8685.9 |
| field_number_write | 2383.1 |
| field_number_read | 11112.9 |
| field_boolean_write | 2295.6 |
| field_boolean_read | 12296.6 |
| field_date_write | 2442.6 |
| field_date_read | 11537.3 |
| field_datetime_write | 2318.6 |
| field_datetime_read | 10867.4 |
| field_json_write | 2336.3 |
| field_json_read | 11348.3 |
| field_image_write | 2427.1 |
| field_image_read | 10538.3 |
| field_counter_write | 2233.5 |
| field_counter_read | 9909.1 |
| field_counter_vote | 11315.3 |
| field_counter_read_totals | 12461.6 |
| field_countermap_write | 2269.8 |
| field_countermap_read | 10561.6 |
| field_countermap_vote | 11286.8 |
| field_countermap_switch | 11922.8 |
| field_countermap_read_totals | 11518 |
| field_relation_write | 2421.3 |
| field_relation_read | 12750.4 |
| core_list | 6199.1 |
| core_304_etag | 11466.4 |
| core_hot_mixed | 10167.1 |
| core_media_upload_64kb | 1181.9 |
| core_media_serve_64kb | 4668.8 |
| core_update | 2260.5 |
| core_delete | 2637.6 |

## Latency p50 / p95 (ms) by phase

| Phase | node-2cpu |
| --- | ---: |
| schema_apply | 1.17 / 2.58 |
| field_text_write | 0.65 / 1 |
| field_text_read | 1.82 / 2.75 |
| field_markdown_write | 0.47 / 0.75 |
| field_markdown_read | 1.67 / 2.24 |
| field_number_write | 0.4 / 0.53 |
| field_number_read | 1.21 / 1.91 |
| field_boolean_write | 0.4 / 0.52 |
| field_boolean_read | 1.17 / 1.72 |
| field_date_write | 0.39 / 0.5 |
| field_date_read | 1.19 / 1.76 |
| field_datetime_write | 0.41 / 0.51 |
| field_datetime_read | 1.22 / 1.79 |
| field_json_write | 0.4 / 0.48 |
| field_json_read | 1.17 / 1.73 |
| field_image_write | 0.4 / 0.5 |
| field_image_read | 1.34 / 1.78 |
| field_counter_write | 0.4 / 0.55 |
| field_counter_read | 1.69 / 1.83 |
| field_counter_vote | 2.54 / 4.36 |
| field_counter_read_totals | 1.18 / 1.46 |
| field_countermap_write | 0.4 / 0.54 |
| field_countermap_read | 1.27 / 1.81 |
| field_countermap_vote | 2.53 / 3.68 |
| field_countermap_switch | 2.45 / 3.55 |
| field_countermap_read_totals | 1.21 / 1.78 |
| field_relation_write | 0.39 / 0.5 |
| field_relation_read | 1.14 / 1.42 |
| core_list | 2.22 / 3.32 |
| core_304_etag | 1.26 / 1.56 |
| core_hot_mixed | 2.86 / 3.97 |
| core_media_upload_64kb | 0.69 / 0.95 |
| core_media_serve_64kb | 2.59 / 8.02 |
| core_update | 0.41 / 0.55 |
| core_delete | 0.36 / 0.45 |

## Run metadata

| Run | Runtime | vCPUs | Peak RSS (MB) | Wall (s) |
| --- | --- | ---: | ---: | ---: |
| node-2cpu | node | 2 | 160 | 18 |
