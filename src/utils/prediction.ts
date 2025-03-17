import * as tf from '@tensorflow/tfjs';

export class PricePredictor {
  private model: tf.LayersModel | null = null;
  private readonly sequenceLength = 20;
  private readonly predictionSteps = 5;
  private readonly featureCount = 6;
  private readonly minTrainingSize = 50;
  private meanStd: { mean: tf.Tensor | null; std: tf.Tensor | null } = { mean: null, std: null };

  constructor() {
    this.initializeModel();
  }

  private async initializeModel() {
    const model = tf.sequential();

    model.add(tf.layers.lstm({
      units: 64,
      returnSequences: true,
      inputShape: [this.sequenceLength, this.featureCount],
      recurrentDropout: 0.2
    }));

    model.add(tf.layers.lstm({
      units: 32,
      returnSequences: false,
      recurrentDropout: 0.2
    }));

    model.add(tf.layers.dropout({ rate: 0.2 }));

    model.add(tf.layers.dense({
      units: 16,
      activation: 'relu',
      kernelRegularizer: tf.regularizers.l2({ l2: 1e-4 })
    }));

    model.add(tf.layers.dense({
      units: this.predictionSteps,
      activation: 'linear'
    }));

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'huberLoss',
      metrics: ['mse']
    });

    this.model = model;
  }

  private preprocessData(data: number[][]): tf.Tensor2D {
    return tf.tidy(() => {
      const tensor = tf.tensor2d(data);
      
      if (!this.meanStd.mean || !this.meanStd.std) {
        this.meanStd.mean = tensor.mean(0);
        const stdTensor = tensor.std(0) as tf.Tensor2D;
        // Add small epsilon to avoid division by zero
        this.meanStd.std = tf.tidy(() => stdTensor.add(tf.scalar(1e-6)));
        stdTensor.dispose();
      }
      
      return tf.tidy(() => {
        const normalized = tensor.sub(this.meanStd.mean as tf.Tensor)
          .div(this.meanStd.std as tf.Tensor);
        return normalized as tf.Tensor2D;
      });
    });
  }

  private createSequences(data: tf.Tensor2D): [tf.Tensor3D, tf.Tensor2D] {
    return tf.tidy(() => {
      const sequences: number[][][] = [];
      const targets: number[][] = [];
      
      const dataArray = data.arraySync() as number[][];
      
      for (let i = 0; i < dataArray.length - this.sequenceLength - this.predictionSteps; i++) {
        sequences.push(dataArray.slice(i, i + this.sequenceLength));
        targets.push(dataArray.slice(i + this.sequenceLength, i + this.sequenceLength + this.predictionSteps).map(x => x[3]));
      }

      return [
        tf.tensor3d(sequences),
        tf.tensor2d(targets)
      ];
    });
  }

  public async train(historicalData: number[][]): Promise<{ loss: number; mse: number }> {
    if (!this.model || historicalData.length < this.minTrainingSize) {
      return { loss: 0, mse: 0 };
    }

    const normalizedData = this.preprocessData(historicalData);
    const [sequences, targets] = this.createSequences(normalizedData);

    try {
      const result = await this.model.fit(sequences, targets, {
        epochs: 50,
        batchSize: 32,
        shuffle: true,
        validationSplit: 0.2,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            if (logs) {
              console.log(`Epoch ${epoch + 1}: loss = ${logs.loss.toFixed(4)}, mse = ${logs.mse.toFixed(4)}`);
            }
          }
        }
      });

      const finalLoss = result.history.loss[result.history.loss.length - 1];
      const finalMse = result.history.mse[result.history.mse.length - 1];

      return {
        loss: typeof finalLoss === 'number' ? finalLoss : Number(finalLoss),
        mse: typeof finalMse === 'number' ? finalMse : Number(finalMse)
      };
    } finally {
      // Clean up tensors
      sequences.dispose();
      targets.dispose();
      normalizedData.dispose();
    }
  }

  public async predict(recentData: number[][]): Promise<{ predictions: number[]; confidence: number }> {
    if (!this.model || !this.meanStd.mean || !this.meanStd.std) {
      return { predictions: [], confidence: 0 };
    }

    return tf.tidy(() => {
      const normalizedData = this.preprocessData(recentData);
      const sequence = tf.tensor3d([normalizedData.arraySync() as number[][]]);
      
      const prediction = this.model!.predict(sequence) as tf.Tensor;
      const predictionArray = prediction.arraySync() as number[][];
      
      const confidence = Math.exp(-predictionArray[0].reduce((sum, val) => sum + Math.abs(val), 0) / predictionArray[0].length);
      
      const meanArray = this.meanStd.mean!.arraySync() as number[];
      const stdArray = this.meanStd.std!.arraySync() as number[];
      
      const denormalizedPredictions = predictionArray[0].map(val => 
        val * stdArray[3] + meanArray[3]
      );
      
      return {
        predictions: denormalizedPredictions,
        confidence
      };
    });
  }

  public dispose(): void {
    if (this.model) {
      this.model.dispose();
    }
    if (this.meanStd.mean) {
      this.meanStd.mean.dispose();
    }
    if (this.meanStd.std) {
      this.meanStd.std.dispose();
    }
  }
}

export const pricePredictor = new PricePredictor();