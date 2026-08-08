/**
 * Generated file — do not edit by hand.
 *
 * Written by `npm run build-prior`. Data-estimated location priors for
 * `hybrid-v1`, averaged over the **tuning** split of the reference sets. The
 * test split never contributed to them.
 *
 * ---------------------------------------------------------------------------
 * ATTRIBUTION — required, do not remove
 *
 * These maps are a derivative work of the UEyes dataset:
 *
 *   Jiang, Yue, Luis A. Leiva, Hamed Rezazadegan Tavakoli, Paul R. B. Houssel,
 *   Julia Kylmälä and Antti Oulasvirta. "UEyes: Understanding Visual Saliency
 *   across User Interface Types." Proceedings of the 2023 CHI Conference on
 *   Human Factors in Computing Systems, pp. 1-21, 2023.
 *   https://doi.org/10.1145/3544548.3581096
 *
 * Licence: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
 * Changes made: the per-image saliency maps of the tuning split were rescaled
 * to a common square grid, averaged, normalised and quantised to 8 bit.
 *
 * See NOTICE.md. The attribution is also shown in the plugin panel, because
 * the maps ship inside the plugin.
 * ---------------------------------------------------------------------------
 */
import type { PriorAsset, PriorAssetId } from './index'

export const PRIOR_ASSETS: Partial<Record<PriorAssetId, PriorAsset>> = {
  web: {
    width: 32,
    height: 32,
    count: 468,
    source: "ueyes-web / tuning / 3s",
    data:
      'Hz9vmbjY8vDd0Mi7qqSikIN0X1FLQzcsJh8WEg4IAwMeQHGhxeT39+TSxbyyrKmbjn9qWlJFNywmIRgRDQgEAxo8b6TP8Pv66NXHwb63s6qci3dnWkk6MCwoHRMMCAQDFjdsoMvt9PLn2NHOy8K6tqmWgnNhUkM4NTAkFw0HBAIVM2mXwOHp6ePa3t/ayL+9sZ2KeWdbTkA6NCYYDQcDARUxY5C42eTh3d7o6uTPxcK0noh2aF9TRDs0JhYNBwMCEy5ejLbW4NrY4u7u5tfQybSagXJpX1NIPzMmFw4IBAMSLVmHs8/Y2dbi7+vi3NfMs5Z9cWteU0tBNCUYEAkFAxErVYGqw87X1t7n4dnd1savlX5ya19UST4zJBgRCgUDECdRe6C7xM3O1NvX1drQvauVgHVoXVJENzAjGBIKBAEPJlF3mbO9w8PK0tHT1Mm2pJF/cmJWTD81LiMZEgkEAQ8mUXSQprO5t7vFyMvHvK2ZiXhnV0xEPDUuJhoSCgQBECNJbIaZpKqnp7K4u7aqn419a1pMRD45NC4lGhILBAEOHTxfe4yTmJSWo6appZePgHFfTkNAPDY0LyYbFAsFAgsXME9qeH2DhIiSlJeVh4B1Z1dFOzw6NDIwJx4UDAYEChQnQVlkaW91eX+Fi4l6c2lgUT42ODUwLSsnIBUMCAQJEyM6TVdbYWlscXmAfnFpYlpKOTQ1MiwmJSQgFAsHAwgRITdGTVBWXmNla3JwZmBeVkM2NTQxKyEfHxwQCQUCCBAgN0NFRkpVWVldZGJbV1dQPzQzMjAqHxsbFw4HBAIJEh8zQUE9P0lPUVJWVlJQTkc5MS4tLCcdGRgUDQcDAQsUHSw5PDc0PEdJRkZHSklGPDArKCQkIxsYFhILBgMBCxIYIy8yMS4zOz03Njo+PjsyJyUfGRwfGRUUEAoFAwIJDhMdJykrLS8wLyopLzIwLSchHhcSFhoWFBIPCgUDAgYLDxkiIyYpKyknIh8lKCUgHRwYEg8SExISEQ4JBQMCBQkMFB4gIiMlJCQfGyAjHxoYGBUQDhAPDxAPDgoHBAIECAsRGBodHyAgIR4bHyEdGRcXEw8NDg0NDw8PCwgFAgQICxAUFxkbHRwdHBscHhsXFhUQDgwMDAwNDg0KCAQCBQkNEBMWFxYYGRkYGBgaFxMSEQ0LCwsKCgoKCQcGBAIFCQ4PEBQVEhMUExMTFBQSDgwLCQgICAgHBgUFBQQCAQQHCgsMDhANDQ0MDA4ODgwJBgUEBQUEBQUEAwIDAwEBAwQGBwYHCAcHBwYGCAkHBgUDAgIDAwIDAwMCAQEBAAACAgMDAgIDAgMEAwMEBQQDAgIBAQICAQICAgIAAAAAAA==',
  },
  mobile: {
    width: 32,
    height: 32,
    count: 468,
    source: "ueyes-mobile / tuning / 3s",
    data:
      'WmuJrc3k7/Dp4drTyLmmlIJzZVhMQzs1MColHxkTDwxld5W31uz3+PPq4tvRxLShjXtrXlNJQTozLCYgGRMPC2t+nb/c8fz++vPr49rPwK2YhHNmW1JJQDgwKSEaEw4La36dv9vv+vz48uvl3tTHtaCLeWxhWE5EOzMrIxsUDgprfpy82Orz9O/p5ODc1cm4pZF/cWVZT0Q7MysjGxMOCmx/nbzX6O/u5+Db2dfSyLqolYNzZVlNQjkxKSEaEw4KaHuZuNLi6ebf19LPzsvEuKiVg3FiVUpANi4nHxgRDQpdboqnwNDY2dTMx8TCwLqwopB+bFxQRTw0LCQcFhALCVFfd5CnuMLGw766t7e1sKeZiHVkVUk/Ni4nHxkTDgoISFRpf5SkrrOysK2trq+so5WCblxNQTgwKSIcFhEMCQhDT2N5jJmhpaalpaepq6mgkX5qV0c7MywmHxoUDwwJB0BMX3SGk5qdn5+goqWnpZ6QfWlWRzsyKyUgGhQQDAkIP0pbbn+Lk5iZmpqcnqCgmo59alhIPDQsJiAaFRAMCgg9RlZnd4OMkJKSk5WXmZiTiXppWEk9NC0mHxgTDwsJCDlBUGBveoOIiouLjY+Qj4l/cmNUSD41LiUdFhEOCwkIMjpIV2Vwd3x+fn5+gIF/eXBkWExDPDUuJR0WEQ0LCQgrMj5MWGJobG1sa2pqamllXVRKQjw2MSoiGxYSDgsJCCUrNUBLVFteX15bWFZWVFFLRD04My4pIx0YFBEODAoJIicvOEJKUFRWVFFOS0lGQz04Mi4qJiEcGBQSEA4MCgkgJCszO0FHSkxLSEZDQkA8ODIsJyIeGhYTEQ8ODAsJCR8jKC81Oj9BQkJAPz49PDk1MCojHhkWFBIRDw4MCgkIHyMoLTI2OTo6Ojo6Ojk3NDEtKCIdGRYVFBMRDw0KCAcdICUrLzEzMzIyMzQ1NDIuKygkIBwZFxcWFRMQDQsJCBgbICUpKisqKistLzAvLSkmIx8cGRcWFhUUEg8NCwkJFBYaHyIjJCQkJScpKSknJSEeGxgWFRQTEhEPDQwKCQgSFBcaHR8gICAgISMjIyIhHxwZFxUTEhEPDgwLCggIBxASFBcZGx0dHRwcHR0eHh4cGxgWFBIQDw0MCggHBgYFDA0PEhQWFxgXFhYVFhcXGBcWFRMRDw4NCwkIBgUEBAQICQoMDQ4PDw8ODg4ODw8PDw4ODAsKCQgHBgUEAwICAgQFBQYHBwcHBwcHBwgICAgICAcHBgUEAwMDAgIBAQEBAgICAwMDAwMDAwMEBAQEBAQEBAMDAgEBAQEBAQEBAAABAQEBAQEBAQEBAgIDAwMCAgICAgEBAQEBAQEBAQEAAA==',
  },
}
