/**
 * Queue Service for handling parallel job processing
 * 
 * This service implements a non-blocking job queue system that allows
 * different types of operations (analysis, caching, etc.) to run in parallel.
 */

class QueueService {
  constructor() {
    // Separate queues for different operation types to prevent blocking
    this.queues = {
      analysis: {
        active: 0,
        maxConcurrent: 5,
        pending: []
      },
      caching: {
        active: 0,
        maxConcurrent: 10,
        pending: []
      },
      validation: {
        active: 0,
        maxConcurrent: 10,
        pending: []
      }
    };
  }

  /**
   * Add a job to a specific queue
   * @param {string} queueType - The type of queue (analysis, caching, validation)
   * @param {Function} jobFunction - The async function to execute
   * @param {object} context - Optional context data to pass to the callback
   * @returns {Promise} A promise that resolves when the job completes
   */
  async addJob(queueType, jobFunction, context = {}) {
    if (!this.queues[queueType]) {
      throw new Error(`Queue type ${queueType} does not exist`);
    }
    
    return new Promise((resolve, reject) => {
      // Create the job object
      const job = {
        id: Math.random().toString(36).substring(2, 15),
        function: jobFunction,
        context,
        resolve,
        reject,
        startTime: null,
        endTime: null
      };
      
      // Add to pending queue
      this.queues[queueType].pending.push(job);
      
      // Process queue (non-blocking)
      setImmediate(() => this.processQueue(queueType));
      
      console.log(`Job ${job.id} added to ${queueType} queue. Active: ${this.queues[queueType].active}, Pending: ${this.queues[queueType].pending.length}`);
    });
  }

  /**
   * Process jobs in a queue
   * @param {string} queueType - The type of queue to process
   */
  async processQueue(queueType) {
    const queue = this.queues[queueType];
    
    // If we're at max concurrency or no pending jobs, exit
    if (queue.active >= queue.maxConcurrent || queue.pending.length === 0) {
      return;
    }
    
    // Get the next job
    const job = queue.pending.shift();
    queue.active++;
    
    console.log(`Processing job ${job.id} from ${queueType} queue. Active: ${queue.active}, Pending: ${queue.pending.length}`);
    
    // Execute the job
    job.startTime = Date.now();
    try {
      const result = await job.function(job.context);
      job.endTime = Date.now();
      
      // Report execution time
      const executionTime = (job.endTime - job.startTime) / 1000;
      console.log(`Job ${job.id} from ${queueType} queue completed in ${executionTime.toFixed(2)}s`);
      
      // Resolve the promise with the result
      job.resolve(result);
    } catch (error) {
      job.endTime = Date.now();
      console.error(`Job ${job.id} from ${queueType} queue failed:`, error);
      job.reject(error);
    } finally {
      // Decrease active count
      queue.active--;
      
      // Process next job if any
      if (queue.pending.length > 0) {
        setImmediate(() => this.processQueue(queueType));
      }
    }
  }

  /**
   * Set the maximum concurrent jobs for a specific queue
   * @param {string} queueType - The type of queue
   * @param {number} maxConcurrent - The maximum number of concurrent jobs
   */
  setMaxConcurrent(queueType, maxConcurrent) {
    if (!this.queues[queueType]) {
      throw new Error(`Queue type ${queueType} does not exist`);
    }
    
    this.queues[queueType].maxConcurrent = maxConcurrent;
    console.log(`Max concurrency for ${queueType} queue set to ${maxConcurrent}`);
    
    // Process queue if needed
    setImmediate(() => this.processQueue(queueType));
  }

  /**
   * Get the current status of all queues
   * @returns {Object} Status of all queues
   */
  getStatus() {
    const status = {};
    
    for (const [type, queue] of Object.entries(this.queues)) {
      status[type] = {
        active: queue.active,
        pending: queue.pending.length,
        maxConcurrent: queue.maxConcurrent
      };
    }
    
    return status;
  }
}

// Export a singleton instance
module.exports = new QueueService(); 