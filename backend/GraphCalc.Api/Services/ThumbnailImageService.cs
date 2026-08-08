using System.Security.Cryptography;
using GraphCalc.Api.Infrastructure;
using ImageMagick;

namespace GraphCalc.Api.Services;

public sealed record ValidatedThumbnailImage(byte[] Data, string ContentType, string Sha256);

public sealed class ThumbnailImageService
{
    public const long MaxFileSize = 5L * 1024L * 1024L;
    private const int MinDimension = 16;
    private const int MaxDimension = 1024;

    public async Task<ValidatedThumbnailImage> ValidateAsync(IFormFile? file, CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            throw new ApiException(StatusCodes.Status400BadRequest, "backend.errors.imageRequired");
        }

        if (file.Length > MaxFileSize)
        {
            throw new ApiException(StatusCodes.Status413PayloadTooLarge, "backend.errors.imageTooLarge");
        }

        await using var stream = new MemoryStream((int)file.Length);
        await file.CopyToAsync(stream, cancellationToken);
        if (stream.Length > MaxFileSize)
        {
            throw new ApiException(StatusCodes.Status413PayloadTooLarge, "backend.errors.imageTooLarge");
        }

        var data = stream.ToArray();
        try
        {
            var info = new MagickImageInfo(data);
            var contentType = GetContentType(info.Format);
            ValidateDimensions(info.Width, info.Height);

            var readSettings = new MagickReadSettings { FrameCount = 2 };
            using var images = new MagickImageCollection(data, readSettings);
            if (images.Count != 1)
            {
                throw new ApiException(StatusCodes.Status400BadRequest, "backend.errors.imageAnimated");
            }

            ValidateDimensions(images[0].Width, images[0].Height);
            if (GetContentType(images[0].Format) != contentType)
            {
                throw new ApiException(StatusCodes.Status400BadRequest, "backend.errors.imageValidation");
            }

            return new ValidatedThumbnailImage(data, contentType, Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant());
        }
        catch (ApiException)
        {
            throw;
        }
        catch (MagickException)
        {
            throw new ApiException(StatusCodes.Status400BadRequest, "backend.errors.imageInvalid");
        }
    }

    private static string GetContentType(MagickFormat format)
    {
        return format switch
        {
            MagickFormat.Png => "image/png",
            MagickFormat.Jpeg => "image/jpeg",
            MagickFormat.WebP => "image/webp",
            _ => throw new ApiException(StatusCodes.Status415UnsupportedMediaType, "backend.errors.imageType")
        };
    }

    private static void ValidateDimensions(uint width, uint height)
    {
        if (width < MinDimension || height < MinDimension || width > MaxDimension || height > MaxDimension)
        {
            throw new ApiException(StatusCodes.Status400BadRequest, "backend.errors.imageDimensions");
        }
    }
}
