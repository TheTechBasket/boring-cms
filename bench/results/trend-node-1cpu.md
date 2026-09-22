# Boring CMS benchmark trend (node-1cpu)

Versions: 0.11.0, 0.14.0, 0.17.0, 0.18.0, 0.18.1, 0.18.3, 0.19.1, 0.20.0, 0.21.0, 0.22.0, 0.23.0
Methodology and constraints: see bench/README.md. Full interactive report with runtime/vCPU/counter filters: bench/results/report.html.

## Overall speed (ops/s, geometric mean, higher is better)

| Version | All phases | Without counter phases | Baseline (common to all versions) |
| --- | ---: | ---: | ---: |
| 0.11.0 | 1273 | 1273 (no counter phases yet, same as "all") | 1273 |
| 0.14.0 | 1253 | 1253 (no counter phases yet, same as "all") | 1253 |
| 0.17.0 | 1124 | 1124 (no counter phases yet, same as "all") | 1124 |
| 0.18.0 | 899 | 899 (no counter phases yet, same as "all") | 1180 |
| 0.18.1 | 919 | 919 (no counter phases yet, same as "all") | 1202 |
| 0.18.3 | 893 | 893 (no counter phases yet, same as "all") | 1173 |
| 0.19.1 | 1016 | 1016 (no counter phases yet, same as "all") | 1672 |
| 0.20.0 | 1542 | 1049 | 1705 |
| 0.21.0 | 1639 | 1166 | 1682 |
| 0.22.0 | 1350 | 984 | 1688 |
| 0.23.0 | 1356 | 1001 | 1796 |

## Throughput (ops/s) by phase, across versions (higher is better)

| Phase | 0.11.0 | 0.14.0 | 0.17.0 | 0.18.0 | 0.18.1 | 0.18.3 | 0.19.1 | 0.20.0 | 0.21.0 | 0.22.0 | 0.23.0 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| schema_apply | 629 | 659 | 625 | 575 | 587 | 582 | 729 | 607 | 570 | 701 | 613 |
| schema_read | 1895 | 1893 | 1750 | 1882 | 1814 | 1922 | 2116 | 1877 | 1943 | 1898 | 2230 |
| create_short | 966 | 997 | 965 | 1002 | 1032 | 994 | 1305 | 1280 | 1248 | 1343 | 1358 |
| create_long | 821 | 876 | 658 | 660 | 675 | 676 | 874 | 812 | 870 | 812 | 889 |
| batch_create_short_x200 | 39 | 29 | 39 | 39 | 39 | 39 | 121 | 120 | 117 | 119 | 108 |
| read_list_short | 1940 | 1979 | 1429 | 1570 | 1645 | 1555 | 3135 | 3172 | 2922 | 3260 | 3766 |
| read_list_long | 536 | 546 | 392 | 403 | 400 | 393 | 2089 | 2170 | 2271 | 2213 | 2595 |
| read_single_short | 2814 | 2723 | 2811 | 2986 | 3063 | 2964 | 3740 | 4082 | 3777 | 3554 | 4820 |
| read_single_long | 2496 | 2296 | 1810 | 2202 | 2170 | 2034 | 2635 | 2830 | 2661 | 2505 | 2380 |
| read_304_etag | 3859 | 3712 | 3538 | 3753 | 4068 | 3728 | 4310 | 4846 | 4789 | 4727 | 4705 |
| update_then_read | 823 | 784 | 799 | 876 | 896 | 827 | 1019 | 1132 | 1150 | 1049 | 939 |
| media_upload_64kb | 785 | 1017 | 848 | 929 | 971 | 893 | 776 | 777 | 807 | 794 | 1244 |
| media_serve_64kb | 1290 | 1190 | 1106 | 1360 | 1258 | 1286 | 1483 | 1450 | 1415 | 1472 | 1359 |
| media_reupload | 947 | 913 | 650 | 631 | 969 | 645 | 714 | 766 | 788 | 758 | 1179 |
| media_delete | 2027 | 1971 | 1786 | 1809 | 1818 | 1754 | 2416 | 2241 | 2265 | 2249 | 1730 |
| link_access | 3215 | 3120 | 3038 | 2789 | 2926 | 2870 | 3502 | 3836 | 3742 | 3859 | 4504 |
| read_concurrent_20 | 4787 | 4737 | 4005 | 4143 | 3734 | 4192 | 6255 | 6291 | 6079 | 6277 | 7331 |
| write_concurrent_10 | 2288 | 2291 | 1940 | 2361 | 1774 | 2329 | 3186 | 3210 | 3093 | 3129 | 2681 |
| delete_entries | 1670 | 1591 | 1643 | 1541 | 1724 | 1701 | 2088 | 2726 | 2637 | 2510 | 2531 |
| create_short_restcall | n/a | n/a | n/a | 1428 | 1433 | 1380 | 1857 | 1824 | 1761 | 1780 | 1920 |
| rewrite_dry_1pair | n/a | n/a | n/a | 200 | 220 | 212 | 194 | 199 | 200 | 201 | 179 |
| rewrite_dry_200pairs | n/a | n/a | n/a | 123 | 130 | 116 | 141 | 151 | 148 | 131 | 137 |
| rewrite_live_200pairs | n/a | n/a | n/a | 105 | 106 | 105 | 90 | 103 | 83 | 94 | 94 |
| schedule_future | n/a | n/a | n/a | n/a | n/a | n/a | 918 | 983 | 964 | 996 | 1070 |
| read_list_short_with_scheduled | n/a | n/a | n/a | n/a | n/a | n/a | 2448 | 2546 | 2643 | 2682 | 2450 |
| read_single_scheduled_404 | n/a | n/a | n/a | n/a | n/a | n/a | 4245 | 5260 | 4985 | 5279 | 5217 |
| list_scheduled | n/a | n/a | n/a | n/a | n/a | n/a | 1318 | 1461 | 1479 | 1459 | 1637 |
| get_entry_draft_scheduled | n/a | n/a | n/a | n/a | n/a | n/a | 2490 | 2408 | 2572 | 2488 | 2740 |
| reschedule_entry | n/a | n/a | n/a | n/a | n/a | n/a | 2168 | 2137 | 2322 | 2345 | 2279 |
| scheduled_goes_live | n/a | n/a | n/a | n/a | n/a | n/a | 0.3 | 0.3 | 0.3 | 0.3 | 0.3 |
| misc_seed (counter) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 1433 | 1408 | 1427 | 1442 |
| misc_read_only (counter) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 5474 | 5872 | 5409 | 6175 |
| misc_read_write (counter) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 4886 | 5203 | 5064 | 4912 |
| misc_write_votes (counter) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 9039 | 8906 | 8495 | 9345 |
| misc_write_edits (counter) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 1818 | 2054 | 1876 | 2100 |
| misc_hot_votes (counter) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 8585 | 8603 | 8449 | 9279 |
| misc_hot_mixed (counter) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 10953 | 11115 | 10953 | 11893 |
| misc_hot_repeat_voters (counter) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 10877 | 10462 | 10514 | 11358 |
| misc_private_bump (counter) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 7849 | 8107 | 7756 | 9218 |
| openapi_read | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 5900 | 6255 | 6671 |
| auth_gate_probes | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 3873 | 3759 | 3488 |
| rate_limit_on | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 2448 | 3263 | 3535 |
| check_schema_health | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 175 | 182 |
| guard_update_field_large | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 632 | 624 |
| guard_update_field_small | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 677 | 669 |
| guard_add_field_forced_large | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 365 | 370 |
| guard_add_field_forced_small | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 633 | 643 |
| field_archive_restore_cycle_large | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 374 | 369 |
| field_archive_restore_cycle_small | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 314 | 401 |
| read_list_clamped | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 4479 |
| read_updated_since_bare | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 3567 |
| etag_republish_preserve | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 688 |
| login_rate_limit | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 34 |

