# Boring CMS benchmark v0.25.0

Run: 2026-10-06T16:22:51.408Z on Linux 7.1.10-200.fc44.x86_64, AMD Ryzen 5 5600X 6-Core Processor (12 cores host).
Constraints and methodology: see bench/README.md. Read it before comparing numbers; the CPU pinning, memory caps, rate limit override, and client placement all shape these results.

## Throughput (ops/s) by phase

| Phase | node-2cpu |
| --- | ---: |
| schema_apply | 880.3 |
| field_text_write | 1525.8 |
| field_text_read | 8182.3 |
| field_markdown_write | 2188.9 |
| field_markdown_read | 10493.2 |
| field_number_write | 2707.1 |
| field_number_read | 12820.4 |
| field_boolean_write | 2577.3 |
| field_boolean_read | 13109.3 |
| field_date_write | 2490.5 |
| field_date_read | 12635.5 |
| field_datetime_write | 2646.7 |
| field_datetime_read | 12190.4 |
| field_json_write | 2746 |
| field_json_read | 13110.6 |
| field_image_write | 2533.4 |
| field_image_read | 11139.7 |
| field_counter_write | 2584.2 |
| field_counter_read | 13539.6 |
| field_counter_vote | 11769.1 |
| field_counter_read_totals | 13173 |
| field_countermap_write | 2460.2 |
| field_countermap_read | 13010.6 |
| field_countermap_vote | 11999.8 |
| field_countermap_switch | 12103.9 |
| field_countermap_read_totals | 12644 |
| field_relation_write | 2541.3 |
| field_relation_read | 11712 |
| core_list | 6637.4 |
| core_304_etag | 11202.8 |
| core_hot_mixed | 9568.8 |
| core_media_upload_64kb | 1119.7 |
| core_media_serve_64kb | 4425.7 |
| core_update | 2514 |
| core_delete | 2606.9 |

## Latency p50 / p95 (ms) by phase

| Phase | node-2cpu |
| --- | ---: |
| schema_apply | 0.93 / 2.17 |
| field_text_write | 0.62 / 0.86 |
| field_text_read | 1.68 / 3.34 |
| field_markdown_write | 0.42 / 0.53 |
| field_markdown_read | 1.31 / 1.99 |
| field_number_write | 0.36 / 0.44 |
| field_number_read | 1.09 / 1.31 |
| field_boolean_write | 0.35 / 0.45 |
| field_boolean_read | 1.09 / 1.57 |
| field_date_write | 0.38 / 0.43 |
| field_date_read | 1.12 / 1.69 |
| field_datetime_write | 0.35 / 0.45 |
| field_datetime_read | 1.12 / 1.57 |
| field_json_write | 0.35 / 0.44 |
| field_json_read | 1.09 / 1.44 |
| field_image_write | 0.35 / 0.48 |
| field_image_read | 1.16 / 1.82 |
| field_counter_write | 0.35 / 0.45 |
| field_counter_read | 1.06 / 1.52 |
| field_counter_vote | 2.41 / 4.14 |
| field_counter_read_totals | 1.12 / 1.29 |
| field_countermap_write | 0.36 / 0.51 |
| field_countermap_read | 1.1 / 1.5 |
| field_countermap_vote | 2.33 / 4.02 |
| field_countermap_switch | 2.35 / 3.84 |
| field_countermap_read_totals | 1.1 / 1.54 |
| field_relation_write | 0.35 / 0.45 |
| field_relation_read | 1.12 / 1.75 |
| core_list | 2.21 / 3.22 |
| core_304_etag | 1.2 / 1.78 |
| core_hot_mixed | 2.83 / 4.4 |
| core_media_upload_64kb | 0.66 / 1.63 |
| core_media_serve_64kb | 2.86 / 8.84 |
| core_update | 0.37 / 0.44 |
| core_delete | 0.36 / 0.47 |

## Run metadata

| Run | Runtime | vCPUs | Peak RSS (MB) | Wall (s) |
| --- | --- | ---: | ---: | ---: |
| node-2cpu | node | 2 | 169 | 17 |
