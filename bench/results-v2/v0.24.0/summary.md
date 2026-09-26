# Boring CMS benchmark v0.24.0

Run: 2026-09-26T06:29:11.322Z on Linux 7.1.10-200.fc44.x86_64, AMD Ryzen 5 5600X 6-Core Processor (12 cores host).
Constraints and methodology: see bench/README.md. Read it before comparing numbers; the CPU pinning, memory caps, rate limit override, and client placement all shape these results.

## Throughput (ops/s) by phase

| Phase | node-2cpu |
| --- | ---: |
| schema_apply | 870.5 |
| field_text_write | 1447 |
| field_text_read | 6930.8 |
| field_markdown_write | 1937 |
| field_markdown_read | 9144.2 |
| field_number_write | 2135.2 |
| field_number_read | 11043.8 |
| field_boolean_write | 2148.6 |
| field_boolean_read | 11543.9 |
| field_date_write | 2142.8 |
| field_date_read | 12790.3 |
| field_datetime_write | 2170.9 |
| field_datetime_read | 11266.1 |
| field_json_write | 2255.4 |
| field_json_read | 12040.5 |
| field_image_write | 2355.4 |
| field_image_read | 12203.3 |
| field_counter_write | 2394.9 |
| field_counter_read | 12736.6 |
| field_counter_vote | 10514.2 |
| field_counter_read_totals | 13407.7 |
| field_countermap_write | 2374.6 |
| field_countermap_read | 13410.1 |
| field_countermap_vote | 11002 |
| field_countermap_switch | 10544.2 |
| field_countermap_read_totals | 11502.9 |
| field_relation_write | 2159.5 |
| field_relation_read | 12938.7 |
| core_list | 7165.8 |
| core_304_etag | 10976.1 |
| core_hot_mixed | 10514.5 |
| core_media_upload_64kb | 1123 |
| core_media_serve_64kb | 4641.1 |
| core_update | 2418.4 |
| core_delete | 2716 |

## Latency p50 / p95 (ms) by phase

| Phase | node-2cpu |
| --- | ---: |
| schema_apply | 1.03 / 2.03 |
| field_text_write | 0.64 / 0.92 |
| field_text_read | 2.16 / 3.3 |
| field_markdown_write | 0.48 / 0.6 |
| field_markdown_read | 1.42 / 2.32 |
| field_number_write | 0.47 / 0.56 |
| field_number_read | 1.23 / 1.97 |
| field_boolean_write | 0.43 / 0.56 |
| field_boolean_read | 1.19 / 1.96 |
| field_date_write | 0.46 / 0.54 |
| field_date_read | 1.12 / 1.58 |
| field_datetime_write | 0.45 / 0.55 |
| field_datetime_read | 1.18 / 1.81 |
| field_json_write | 0.42 / 0.45 |
| field_json_read | 1.15 / 1.98 |
| field_image_write | 0.41 / 0.49 |
| field_image_read | 1.18 / 1.74 |
| field_counter_write | 0.4 / 0.45 |
| field_counter_read | 1.13 / 1.72 |
| field_counter_vote | 2.6 / 5.31 |
| field_counter_read_totals | 1.1 / 1.34 |
| field_countermap_write | 0.39 / 0.49 |
| field_countermap_read | 1.08 / 1.34 |
| field_countermap_vote | 2.5 / 5.08 |
| field_countermap_switch | 2.56 / 5.18 |
| field_countermap_read_totals | 1.19 / 2.05 |
| field_relation_write | 0.44 / 0.55 |
| field_relation_read | 1.11 / 1.39 |
| core_list | 2.04 / 2.81 |
| core_304_etag | 1.24 / 2 |
| core_hot_mixed | 2.67 / 4.21 |
| core_media_upload_64kb | 0.7 / 1.05 |
| core_media_serve_64kb | 2.62 / 8.69 |
| core_update | 0.39 / 0.49 |
| core_delete | 0.34 / 0.43 |

## Run metadata

| Run | Runtime | vCPUs | Peak RSS (MB) | Wall (s) |
| --- | --- | ---: | ---: | ---: |
| node-2cpu | node | 2 | 170 | 18 |
