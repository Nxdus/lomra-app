import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class ObjectStorageService implements OnModuleInit, OnModuleDestroy {
  readonly bucket = process.env.S3_BUCKET ?? 'lomra-canvas';
  readonly client = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:8333',
    region: process.env.S3_REGION ?? 'us-east-1', forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'lomra-local',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'lomra-local-development-only',
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });

  async onModuleInit() {
    await this.client.send(new PutBucketCorsCommand({ Bucket: this.bucket, CORSConfiguration: { CORSRules: [{
      AllowedOrigins: [new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').origin],
      AllowedMethods: ['GET', 'HEAD'], AllowedHeaders: ['*'], MaxAgeSeconds: 3600,
    }] } }));
  }

  onModuleDestroy() { this.client.destroy(); }

  async exists(owner: string, id: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: `${owner}/${id}` }));
      return true;
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
      throw error;
    }
  }

  async write(owner: string, id: string, data: Buffer) {
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: `${owner}/${id}`, Body: data,
        ContentType: 'application/octet-stream', IfNoneMatch: '*' }));
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error;
    }
  }

  download(owner: string, id: string) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: `${owner}/${id}` }), { expiresIn: 900 });
  }

  async remove(owner: string, id: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: `${owner}/${id}` }));
  }

  async copy(source: string, target: string, id: string) {
    if (await this.exists(target, id) || !await this.exists(source, id)) return;
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: `${source}/${id}` }));
    await this.write(target, id, Buffer.from(await object.Body!.transformToByteArray()));
  }
}
