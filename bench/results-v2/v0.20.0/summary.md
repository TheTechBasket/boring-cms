# Boring CMS benchmark v0.20.0

Run: 2026-09-26T06:28:40.985Z on Linux 7.1.10-200.fc44.x86_64, AMD Ryzen 5 5600X 6-Core Processor (12 cores host).
Constraints and methodology: see bench/README.md. Read it before comparing numbers; the CPU pinning, memory caps, rate limit override, and client placement all shape these results.

## Throughput (ops/s) by phase

| Phase | node-2cpu |
| --- | ---: |
| schema_apply | 799.2 |
| field_text_write | 1415.4 |
| field_text_read | 7186.1 |
| field_markdown_write | 1923.9 |
| field_markdown_read | 7998 |
| field_number_write | 2311 |
| field_number_read | 9673.4 |
| field_boolean_write | 2171.6 |
| field_boolean_read | 9300.5 |
| field_date_write | 2390.1 |
| field_date_read | 9700.7 |
| field_datetime_write | 2407.8 |
| field_datetime_read | 10437.5 |
| field_json_write | 2436.6 |
| field_json_read | 10097.2 |
| field_image_write | 2429.4 |
| field_image_read | 10326.5 |
| field_counter_write | 2350.6 |
| field_counter_read | 9490.4 |
| field_counter_vote | 9232 |
| field_counter_read_totals | 9873.1 |
| field_relation_write | 1995.7 |
| field_relation_read | 9915.1 |
| core_list | 6880.2 |
| core_304_etag | 11527.3 |
| core_hot_mixed | 9263 |
| core_media_upload_64kb | 1060.2 |
| core_media_serve_64kb | 3886 |
| core_update | 2232.3 |
| core_delete | 2492.4 |

## Latency p50 / p95 (ms) by phase

| Phase | node-2cpu |
| --- | ---: |
| schema_apply | 1.17 / 2.38 |
| field_text_write | 0.66 / 0.99 |
| field_text_read | 1.95 / 4.14 |
| field_markdown_write | 0.48 / 0.61 |
| field_markdown_read | 1.65 / 3.85 |
| field_number_write | 0.41 / 0.51 |
| field_number_read | 1.34 / 2.8 |
| field_boolean_write | 0.42 / 0.53 |
| field_boolean_read | 1.4 / 2.95 |
| field_date_write | 0.41 / 0.48 |
| field_date_read | 1.31 / 2.75 |
| field_datetime_write | 0.39 / 0.47 |
| field_datetime_read | 1.27 / 2.67 |
| field_json_write | 0.4 / 0.48 |
| field_json_read | 1.28 / 2.74 |
| field_image_write | 0.39 / 0.45 |
| field_image_read | 1.28 / 2.66 |
| field_counter_write | 0.41 / 0.52 |
| field_counter_read | 1.36 / 2.85 |
| field_counter_vote | 2.98 / 6.06 |
| field_counter_read_totals | 1.3 / 2.72 |
| field_relation_write | 0.45 / 0.58 |
| field_relation_read | 1.32 / 2.74 |
| core_list | 2.09 / 2.98 |
| core_304_etag | 1.2 / 1.92 |
| core_hot_mixed | 3.05 / 5.55 |
| core_media_upload_64kb | 0.68 / 1.29 |
| core_media_serve_64kb | 3.11 / 10.42 |
| core_update | 0.42 / 0.51 |
| core_delete | 0.39 / 0.49 |

## Run metadata

| Run | Runtime | vCPUs | Peak RSS (MB) | Wall (s) |
| --- | --- | ---: | ---: | ---: |
| node-2cpu | node | 2 | 159 | 15 |
