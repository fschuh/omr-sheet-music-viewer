# online_amt model

`online_amt_streaming.onnx` is a fixed-shape, state-explicit export of the
pretrained `model-180000.pt` checkpoint from
<https://github.com/jdasam/online_amt>.

- Source revision: `f353035175cc3436ebdc411530a9e73c966d2077`
- Source checkpoint SHA-256:
  `54AB4907B517DBFA2DBBEE834DB18D31D103EE25D690860595181162D235E3A0`
- Exported ONNX SHA-256:
  `A77BE8262D3742CE4D9E7D29146D8B17F5755650A7D2AEE952BF5BF5ED190AC4`
- Exported size: 71,955,821 bytes
- Input: one mono `[1, 512]` float32 audio chunk at 16 kHz plus explicit
  recurrent state

The graph is tracked with Git LFS. Export and validation instructions live in
`tools/online_amt/README.md`.
