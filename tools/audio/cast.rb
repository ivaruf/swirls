# A cast lands: one soft struck chime, a pebble meeting still water.
#
# Heard more than anything else in swirls — a drag casts a seed every forty
# milliseconds or so — which decides everything about it. It is short, it has
# almost no attack transient to get sharp about, and it is quiet enough to
# layer with itself without turning into a rattle. The runtime throttles it and
# varies its playback rate with the charge (hub CLAUDE.md §9: six pitches of
# one yip is a file and a playbackRate, not six oscillators), so this file is
# the one voice the whole gesture vocabulary is built from.
#
# B5 with its fifth above, drawn from the same E minor pentatonic the bed's
# bells use, so a tap anywhere in the loop is consonant with whatever chord
# happens to be sounding.
with_fx :reverb, room: 0.8, mix: 0.45 do
  with_fx :lpf, cutoff: 112 do
    use_synth :pretty_bell
    play :b5, attack: 0.004, decay: 0.1, sustain: 0.05, release: 1.1, amp: 0.55
    use_synth :sine
    play :fs6, attack: 0.03, release: 0.6, amp: 0.1, pan: 0.15
  end
end
