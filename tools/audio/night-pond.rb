# Night Pond — a pale glow that glides where sent, sheds ripple rings along
# its wake, then sinks with one last widening ring.
#
# TIMBRE: water, round and closed. It starts under a cutoff of 62 — almost no
# sound in it at all — and the filter opens outward over two thirds of a
# second. That opening IS the ring widening, and it is why this cue needed no
# transient to read as a drop in still water. A struck bell would have been
# the obvious way to do it and the wrong one.
# MOTION: one ring, then a second, fainter, a third of a second behind — the
# effect's own wake.
with_fx :reverb, room: 0.75, mix: 0.4 do
  use_synth :hollow
  n = play :gs3, attack: 0.16, sustain: 0.1, release: 0.6, amp: 0.82, cutoff: 62, cutoff_slide: 0.7
  control n, cutoff: 92
  sleep 0.34
  use_synth :sine
  play :ds4, attack: 0.15, release: 0.55, amp: 0.28
end
